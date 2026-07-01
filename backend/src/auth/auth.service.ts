import { Injectable, ConflictException, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { User } from './entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { UserRole } from '../common/enums/role.enum';
import { AuditService } from '../audit/audit.service';
import { JWT_ACCESS_SECRET, ACCESS_TOKEN_EXPIRY, ACCESS_TOKEN_EXPIRES_IN_SECONDS, ARGON2_OPTIONS } from './constants';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    private readonly jwtService: JwtService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Register new user with hashed password
   * First user in system automatically gets admin role
   */
  async register(registerDto: RegisterDto) {
    const { email, password, displayName } = registerDto;

    // Check for duplicate email
    const existingUser = await this.userRepository.findOneBy({ email });
    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    // Hash password with argon2 - never store plain text
    const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);

    // Determine role: first user is admin, others are viewer
    const userCount = await this.userRepository.count();
    const role = userCount === 0 ? UserRole.ADMIN : UserRole.VIEWER;

    // Create and save user
    const user = this.userRepository.create({
      email,
      password_hash: passwordHash,
      display_name: displayName,
      role,
      is_active: true,
    });

    const savedUser = await this.userRepository.save(user);
    savedUser.tenant_id = savedUser.id;
    await this.userRepository.save(savedUser);

    // Auto-login: generate tokens
    const { accessToken, refreshToken } = await this._generateTokens(savedUser);

    // Store hashed refresh token in DB
    await this._storeRefreshToken(savedUser.id, refreshToken);

    return this._tokenResponse(savedUser, accessToken, refreshToken);
  }

  /**
   * Validate user credentials
   * Returns user without password or null if invalid
   */
  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.userRepository.findOneBy({ email });

    if (!user) {
      return null; // Prevent user enumeration: same response for "user not found"
    }

    const isPasswordValid = await argon2.verify(user.password_hash, password);

    if (!isPasswordValid) {
      return null;
    }

    return this._excludePassword(user) as User;
  }

  /**
   * Login: validate credentials and return tokens
   * Implements single-session: deletes all previous refresh tokens
   */
  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    const user = await this.validateUser(email, password);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Single-session enforcement: delete all previous refresh tokens
    await this.refreshTokenRepository.delete({ user_id: user.id });

    // Generate new tokens
    const { accessToken, refreshToken } = await this._generateTokens(user);

    // Store hashed refresh token
    await this._storeRefreshToken(user.id, refreshToken);

    // Update last login time
    await this.userRepository.update(user.id, { last_login_at: new Date() });
    await this.auditService.record({
      actorUserId: user.id,
      action: 'auth.login',
      entityType: 'user',
      entityId: String(user.id),
      metadata: { outcome: 'success' },
    });

    return this._tokenResponse(user, accessToken, refreshToken);
  }

  /**
   * Refresh tokens with rotation
   * CRITICAL SECURITY:
   * - Detects replay attacks: if token already replaced (replaced_by_id !== null), revokes all user tokens
   * - Marks old token as revoked and sets replaced_by_id to new token id
   * - Creates new access + refresh token pair
   */
  async refresh(refreshTokenDto: RefreshTokenDto) {
    const { refreshToken } = refreshTokenDto;
    const tokenHash = this._hashRefreshToken(refreshToken);
    const tokenEntry = await this.refreshTokenRepository.findOne({
      where: { token_hash: tokenHash },
    });

    if (!tokenEntry) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (tokenEntry.replaced_by_id !== null) {
      await this.refreshTokenRepository.update(
        { user_id: tokenEntry.user_id },
        { revoked: true },
      );

      throw new UnauthorizedException('Token replay detected - all sessions revoked');
    }

    if (tokenEntry.revoked) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (tokenEntry.expires_at && new Date(tokenEntry.expires_at) < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.userRepository.findOne({ where: { id: tokenEntry.user_id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const { accessToken, refreshToken: newRefreshToken } = await this._generateTokens(user);

    const newTokenEntry = this.refreshTokenRepository.create({
      user_id: user.id,
      token_hash: this._hashRefreshToken(newRefreshToken),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      revoked: false,
    });
    const savedNewToken = await this.refreshTokenRepository.save(newTokenEntry);

    await this.refreshTokenRepository.update(
      { id: tokenEntry.id },
      {
        revoked: true,
        replaced_by_id: savedNewToken.id,
      },
    );

    await this.refreshTokenRepository
      .createQueryBuilder()
      .delete()
      .where('user_id = :userId', { userId: user.id })
      .andWhere('id NOT IN (:...ids)', { ids: [savedNewToken.id, tokenEntry.id] })
      .execute();
    await this.auditService.record({
      actorUserId: user.id,
      action: 'auth.refresh',
      entityType: 'user',
      entityId: String(user.id),
      metadata: { outcome: 'success' },
    });

    return this._tokenResponse(user, accessToken, newRefreshToken);
  }

  /**
   * Logout: revoke all refresh tokens for user
   */
  async logout(userId: number): Promise<void> {
    await this.refreshTokenRepository.update(
      { user_id: userId },
      { revoked: true },
    );
    await this.auditService.record({
      actorUserId: userId,
      action: 'auth.logout',
      entityType: 'user',
      entityId: String(userId),
      metadata: { outcome: 'success' },
    });
  }

  async listSessions(userId: number) {
    const sessions = await this.refreshTokenRepository.find({
      where: { user_id: userId, revoked: false },
      order: { created_at: 'DESC' },
    });

    return sessions.map(({ token_hash, ...session }) => session);
  }

  /**
   * Get current user (no password)
   */
  async getMe(userId: number): Promise<Partial<User>> {
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this._excludePassword(user);
  }

  /**
   * Internal: Generate access + refresh token pair
   */
  private async _generateTokens(user: User) {
    const accessToken = this.jwtService.sign(
      { sub: user.id, email: user.email, role: user.role, tenantId: user.tenant_id ?? user.id },
      { secret: JWT_ACCESS_SECRET, expiresIn: ACCESS_TOKEN_EXPIRY },
    );

    const refreshToken = crypto.randomBytes(32).toString('hex');

    return { accessToken, refreshToken };
  }

  /**
   * Internal: Store refresh token as hashed value in DB
   */
  private async _storeRefreshToken(userId: number, refreshToken: string) {
    const tokenHash = this._hashRefreshToken(refreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const tokenEntry = this.refreshTokenRepository.create({
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiresAt,
      revoked: false,
    });

    await this.refreshTokenRepository.save(tokenEntry);
  }

  private _hashRefreshToken(refreshToken: string): string {
    return crypto.createHash('sha256').update(refreshToken).digest('hex');
  }

  private _tokenResponse(user: User, accessToken: string, refreshToken: string) {
    return {
      user: this._excludePassword(user),
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: ACCESS_TOKEN_EXPIRES_IN_SECONDS,
    };
  }

  /**
   * Internal: Exclude password from user object using class-transformer
   */
  private _excludePassword(user: User): Partial<User> {
    const { password_hash, ...safeUser } = user;
    return safeUser;
  }
}
