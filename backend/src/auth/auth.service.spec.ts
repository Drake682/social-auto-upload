import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { BadRequestException, ConflictException, UnauthorizedException, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { AuthService } from './auth.service';
import { User } from './entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { UserRole } from '../common/enums/role.enum';
import { AuditService } from '../audit/audit.service';

jest.mock('argon2');

describe('AuthService', () => {
  let service: AuthService;
  let userRepository: jest.Mocked<Repository<User>>;
  let refreshTokenRepository: jest.Mocked<Repository<RefreshToken>>;
  let jwtService: jest.Mocked<JwtService>;
  let auditService: jest.Mocked<AuditService>;

  const mockUser: User = {
    id: 1,
    email: 'test@example.com',
    password_hash: 'hashed_password',
    display_name: 'Test User',
    role: UserRole.VIEWER,
    license_key: null,
    is_active: true,
    last_login_at: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
  } as User;

  const createMockRepository = () => ({
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    find: jest.fn(),
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({}),
      getOne: jest.fn(),
      getMany: jest.fn().mockResolvedValue([]),
    })),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(User),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: createMockRepository(),
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(),
            verify: jest.fn(),
          },
        },
        {
          provide: AuditService,
          useValue: {
            record: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    userRepository = module.get(getRepositoryToken(User));
    refreshTokenRepository = module.get(getRepositoryToken(RefreshToken));
    jwtService = module.get(JwtService);
    auditService = module.get(AuditService);

    // Default sign mock returns predictable tokens
    jwtService.sign
      .mockReturnValueOnce('access_token_value')
      .mockReturnValueOnce('refresh_token_value');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    const registerDto: RegisterDto = {
      email: 'new@example.com',
      password: 'strongPass123',
      displayName: 'New User',
    };

    it('should create a new user with hashed password (never plain text)', async () => {
      userRepository.count.mockResolvedValue(0);
      userRepository.findOneBy.mockResolvedValue(null);
      userRepository.create.mockReturnValue(mockUser);
      userRepository.save.mockResolvedValue(mockUser);
      (argon2.hash as jest.Mock).mockResolvedValue('hashed_password');

      const result = await service.register(registerDto);

      expect(argon2.hash).toHaveBeenCalledWith(registerDto.password, expect.any(Object));
      expect(userRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: registerDto.email,
          password_hash: 'hashed_password',
          display_name: registerDto.displayName,
          role: UserRole.ADMIN, // First user becomes admin
        }),
      );
      // Verify password never stored or returned in plain text
      expect(JSON.stringify(result)).not.toContain(registerDto.password);
      expect(result.user).not.toHaveProperty('password_hash');
      expect(result).toHaveProperty('access_token');
      expect(result).toHaveProperty('refresh_token');
      expect(result).toHaveProperty('expires_in', 900);
    });

    it('should reject duplicate email with 409 Conflict', async () => {
      userRepository.findOneBy.mockResolvedValue(mockUser);

      await expect(service.register(registerDto)).rejects.toThrow(ConflictException);
    });

    it('should assign first user as admin, subsequent as viewer', async () => {
      userRepository.findOneBy.mockResolvedValue(null);
      userRepository.create.mockReturnValue(mockUser);
      userRepository.save.mockResolvedValue(mockUser);
      (argon2.hash as jest.Mock).mockResolvedValue('hashed_password');

      // First user -> admin
      userRepository.count.mockResolvedValue(0);
      await service.register(registerDto);
      expect(userRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: UserRole.ADMIN }),
      );

      // Second user -> viewer
      userRepository.count.mockResolvedValue(1);
      userRepository.create.mockReturnValue({ ...mockUser, role: UserRole.VIEWER });
      await service.register(registerDto);
      expect(userRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: UserRole.VIEWER }),
      );
    });

    it.skip('should reject weak password', async () => {
      const weakDto = { ...registerDto, password: '123' };
      await expect(service.register(weakDto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('validateUser', () => {
    const loginDto: LoginDto = {
      email: 'test@example.com',
      password: 'correctPass123',
    };

    it('should return user without password when credentials valid', async () => {
      userRepository.findOneBy.mockResolvedValue(mockUser);
      (argon2.verify as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser(loginDto.email, loginDto.password);

      expect(result).toBeDefined();
      expect(result).not.toHaveProperty('password_hash');
      expect(argon2.verify).toHaveBeenCalledWith('hashed_password', loginDto.password);
    });

    it('should return null for invalid email to prevent user enumeration', async () => {
      userRepository.findOneBy.mockResolvedValue(null);

      const result = await service.validateUser(loginDto.email, loginDto.password);

      expect(result).toBeNull();
    });

    it('should return null for invalid password', async () => {
      userRepository.findOneBy.mockResolvedValue(mockUser);
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      const result = await service.validateUser(loginDto.email, loginDto.password);

      expect(result).toBeNull();
    });
  });

  describe('login', () => {
    const loginDto: LoginDto = {
      email: 'test@example.com',
      password: 'correctPass123',
    };

    it('should return tokens and user, storing hashed refresh token', async () => {
      userRepository.findOneBy.mockResolvedValue(mockUser);
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      refreshTokenRepository.create.mockReturnValue({} as RefreshToken);
      refreshTokenRepository.save.mockResolvedValue({ id: 1 } as RefreshToken);
      refreshTokenRepository.delete.mockResolvedValue({ affected: 1, raw: [] });
      userRepository.update.mockResolvedValue({} as any);

      const result = await service.login(loginDto);

      expect(refreshTokenRepository.delete).toHaveBeenCalledWith({ user_id: mockUser.id });
      expect(refreshTokenRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: mockUser.id,
          token_hash: crypto.createHash('sha256').update((result as any).refresh_token).digest('hex'),
          revoked: false,
        }),
      );
      expect(result).toHaveProperty('access_token');
      expect(result).toHaveProperty('refresh_token');
      expect(result).toHaveProperty('expires_in', 900);
      expect(result.user).not.toHaveProperty('password_hash');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.login', actorUserId: mockUser.id }),
      );
    });

    it('should throw 401 for invalid credentials (generic error)', async () => {
      userRepository.findOneBy.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refresh', () => {
    const refreshDto: RefreshTokenDto = {
      refreshToken: 'old_refresh_token',
    };

    const mockRefreshToken: RefreshToken = {
      id: 1,
      user_id: 1,
      token_hash: crypto.createHash('sha256').update('old_refresh_token').digest('hex'),
      device_info: null,
      expires_at: new Date(Date.now() + 86400000),
      revoked: false,
      replaced_by_id: null,
      created_at: new Date(),
    } as RefreshToken;

    it('should rotate refresh token and return new pair', async () => {
      refreshTokenRepository.findOne.mockResolvedValue(mockRefreshToken);
      userRepository.findOne.mockResolvedValue(mockUser);
      refreshTokenRepository.create.mockReturnValue({} as RefreshToken);
      refreshTokenRepository.save.mockResolvedValue({ id: 2 } as RefreshToken);
      refreshTokenRepository.update.mockResolvedValue({} as any);
      const result = await service.refresh(refreshDto);

      expect(refreshTokenRepository.findOne).toHaveBeenCalledWith({
        where: { token_hash: mockRefreshToken.token_hash },
      });
      expect(argon2.verify).not.toHaveBeenCalledWith(mockRefreshToken.token_hash, 'old_refresh_token');
      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { id: mockRefreshToken.id },
        expect.objectContaining({ revoked: true, replaced_by_id: 2 }),
      );
      expect(result).toHaveProperty('access_token');
      expect(result).toHaveProperty('refresh_token');
      expect(result).toHaveProperty('expires_in', 900);
      expect((result as any).refresh_token).not.toBe('old_refresh_token');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.refresh', actorUserId: mockUser.id }),
      );
    });

    it('should detect replay attack on already-used refresh token', async () => {
      refreshTokenRepository.findOne.mockResolvedValue({
        ...mockRefreshToken,
        replaced_by_id: 2,
      });
      refreshTokenRepository.update.mockResolvedValue({} as any);

      await expect(service.refresh(refreshDto)).rejects.toThrow(UnauthorizedException);
      // All tokens for user should be revoked upon replay detection
      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { user_id: mockRefreshToken.user_id },
        { revoked: true },
      );
    });

    it('should reject expired refresh token', async () => {
      refreshTokenRepository.findOne.mockResolvedValue({
        ...mockRefreshToken,
        expires_at: new Date(Date.now() - 1000),
      });

      await expect(service.refresh(refreshDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should reject revoked refresh token', async () => {
      refreshTokenRepository.findOne.mockResolvedValue({
        ...mockRefreshToken,
        revoked: true,
      });

      await expect(service.refresh(refreshDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should reject non-existent refresh token', async () => {
      refreshTokenRepository.findOne.mockResolvedValue(null);

      await expect(service.refresh(refreshDto)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('should revoke all refresh tokens for the user', async () => {
      refreshTokenRepository.update.mockResolvedValue({} as any);

      await service.logout(1);

      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { user_id: 1 },
        { revoked: true },
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.logout', actorUserId: 1 }),
      );
    });
  });

  describe('listSessions', () => {
    it('should list active refresh-token sessions without token hashes', async () => {
      refreshTokenRepository.find.mockResolvedValue([
        {
          id: 1,
          user_id: 1,
          token_hash: 'secret_hash',
          device_info: { ipAddress: '127.0.0.1' },
          expires_at: new Date(Date.now() + 86400000),
          revoked: false,
          replaced_by_id: null,
          created_at: new Date(),
        } as RefreshToken,
      ]);

      const result = await service.listSessions(1);

      expect(refreshTokenRepository.find).toHaveBeenCalledWith({
        where: { user_id: 1, revoked: false },
        order: { created_at: 'DESC' },
      });
      expect(result[0]).toEqual(
        expect.objectContaining({ id: 1, device_info: { ipAddress: '127.0.0.1' } }),
      );
      expect(result[0]).not.toHaveProperty('token_hash');
    });
  });

  describe('getMe', () => {
    it('should return user without password_hash', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.getMe(1);

      expect(result).toBeDefined();
      expect(result).not.toHaveProperty('password_hash');
      expect(result).toHaveProperty('email');
      expect(result).toHaveProperty('role');
    });

    it('should throw NotFoundException if user not found', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.getMe(1)).rejects.toThrow(NotFoundException);
    });
  });
});
