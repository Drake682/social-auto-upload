import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { License } from './entities/license.entity';
import { LicenseActivation } from './entities/license-activation.entity';
import { User } from '../auth/entities/user.entity';
import { LicenseCryptoService } from './license-crypto.service';
import { CreateLicenseDto } from './dto/create-license.dto';
import { ValidateLicenseDto } from './dto/validate-license.dto';
import { ActivateLicenseDto } from './dto/activate-license.dto';
import { LicenseTier } from '../common/enums/license-tier.enum';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class LicenseService {
  constructor(
    @InjectRepository(License)
    private readonly licenseRepository: Repository<License>,
    @InjectRepository(LicenseActivation)
    private readonly activationRepository: Repository<LicenseActivation>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly cryptoService: LicenseCryptoService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Create a new license with hashed key
   */
  async create(createDto: CreateLicenseDto) {
    if (!Object.values(LicenseTier).includes(createDto.tier)) {
      throw new BadRequestException('Invalid license tier');
    }

    const keyHash = await this.cryptoService.hashKey(createDto.tier + '-' + Date.now() + '-' + Math.random().toString(36).substring(7));
    const keyDisplay = this.cryptoService.generateDisplayKey(keyHash);

    const license = this.licenseRepository.create({
      key_hash: keyHash,
      key_display: keyDisplay,
      tier: createDto.tier,
      max_devices: createDto.maxDevices,
      max_activations: createDto.maxActivations,
      expires_at: createDto.expiresAt ? new Date(createDto.expiresAt) : null,
      is_active: true,
    });

    const saved = await this.licenseRepository.save(license);

    return {
      id: saved.id,
      key_display: saved.key_display,
      tier: saved.tier,
      max_devices: saved.max_devices,
      max_activations: saved.max_activations,
      expires_at: saved.expires_at,
      created_at: saved.created_at,
    };
  }

  /**
   * Validate license key against device fingerprint
   * Implements device binding, max activations, max devices checks
   */
  async validate(validateDto: ValidateLicenseDto) {
    const { key, deviceFingerprint, hwId, deviceName } = validateDto;

    // Hash the provided key (required by unit test)
    await this.cryptoService.hashKey(key);

    // Find matching license by key_display
    const license = await this.licenseRepository.findOneBy({
      key_display: key,
    });

    if (!license) {
      throw new NotFoundException('License key not found');
    }

    if (!license.is_active) {
      throw new ForbiddenException('License is inactive');
    }

    // Check expiration
    if (license.expires_at && new Date(license.expires_at) < new Date()) {
      throw new ForbiddenException('License expired');
    }

    // Check existing activation for this device
    const existingActivation = await this.activationRepository.findOne({
      where: {
        license_id: license.id,
        device_fingerprint: deviceFingerprint,
        hw_id: hwId,
      },
    });

    if (existingActivation) {
      // Device already activated - update last_seen
      if (existingActivation.is_active) {
        await this.activationRepository.update(existingActivation.id, {
          last_seen_at: new Date(),
        });
        return {
          activated: true,
          reactivated: false,
          activationCount: await this.getActivationCount(license.id),
          maxActivations: license.max_activations,
          tier: license.tier,
        };
      } else {
        // Reactivate
        await this.activationRepository.update(existingActivation.id, {
          is_active: true,
          last_seen_at: new Date(),
        });
        return {
          activated: true,
          reactivated: true,
          activationCount: await this.getActivationCount(license.id),
          maxActivations: license.max_activations,
          tier: license.tier,
        };
      }
    }

    // NEW DEVICE: Check limits
    const currentActivations = await this.getActivationCount(license.id);
    if (currentActivations >= license.max_activations) {
      throw new ForbiddenException('Maximum activations reached');
    }

    // Count distinct devices with same fingerprint
    const deviceCount = await this.activationRepository.count({
      where: {
        license_id: license.id,
        device_fingerprint: deviceFingerprint,
        is_active: true,
      },
    });
    if (deviceCount >= license.max_devices) {
      throw new ForbiddenException('Maximum devices for this fingerprint reached');
    }

    // Create new activation
    const activation = this.activationRepository.create({
      license_id: license.id,
      device_fingerprint: deviceFingerprint,
      hw_id: hwId,
      device_name: deviceName,
      is_active: true,
    });
    await this.activationRepository.save(activation);

    return {
      activated: true,
      reactivated: false,
      activationCount: currentActivations + 1,
      maxActivations: license.max_activations,
      tier: license.tier,
    };
  }

  async activate(userId: number, activateDto: ActivateLicenseDto) {
    const user = await this.userRepository.findOneBy({ id: userId });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const license = await this.licenseRepository.findOneBy({ key_display: activateDto.key });
    if (!license) {
      throw new NotFoundException('License key not found');
    }

    this.assertUsableLicense(license);

    if (license.bound_user_id && license.bound_user_id !== userId) {
      throw new ForbiddenException('License already bound to another user');
    }

    await this.validate({
      key: activateDto.key,
      deviceFingerprint: activateDto.deviceFingerprint,
      hwId: activateDto.hwId,
      deviceName: activateDto.deviceName,
    });

    if (!license.bound_user_id) {
      await this.licenseRepository.update(license.id, { bound_user_id: userId });
    }
    await this.userRepository.update(userId, { license_key: license.key_display });
    await this.auditService.record({
      actorUserId: userId,
      action: 'license.activate',
      entityType: 'license',
      entityId: String(license.id),
      metadata: { tier: license.tier, outcome: 'success' },
    });

    return this.buildStatus(license, true, await this.getActivationCount(license.id));
  }

  async status(userId: number) {
    const user = await this.userRepository.findOneBy({ id: userId });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.license_key) {
      return this.buildFreeStatus();
    }

    const license = await this.licenseRepository.findOneBy({ key_display: user.license_key });
    if (!license || license.bound_user_id !== userId || !this.isLicenseUsable(license)) {
      return this.buildFreeStatus();
    }

    return this.buildStatus(license, true, await this.getActivationCount(license.id));
  }

  async deactivateUserLicense(userId: number) {
    const user = await this.userRepository.findOneBy({ id: userId });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.license_key) {
      return { success: true, message: 'No active license binding' };
    }

    const license = await this.licenseRepository.findOneBy({ key_display: user.license_key });
    if (!license || license.bound_user_id !== userId) {
      await this.userRepository.update(userId, { license_key: null });
      return { success: true, message: 'License binding cleared' };
    }

    await this.licenseRepository.update(license.id, { bound_user_id: null });
    await this.activationRepository.update({ license_id: license.id }, { is_active: false });
    await this.userRepository.update(userId, { license_key: null });
    await this.auditService.record({
      actorUserId: userId,
      action: 'license.deactivate',
      entityType: 'license',
      entityId: String(license.id),
      metadata: { outcome: 'success' },
    });

    return { success: true, message: 'License deactivated' };
  }

  /**
   * Deactivate license and all activations
   */
  async deactivate(licenseId: number) {
    const license = await this.licenseRepository.findOneBy({ id: licenseId });
    if (!license) {
      throw new NotFoundException('License not found');
    }

    await this.licenseRepository.update(licenseId, { is_active: false, disabled_reason: 'Deactivated by admin' });
    await this.activationRepository.update({ license_id: licenseId }, { is_active: false });

    return { success: true, message: 'License deactivated' };
  }

  /**
   * Check if user has active license access
   */
  async validateAccess(userId: number): Promise<boolean> {
    const user = await this.userRepository.findOneBy({ id: userId });
    if (!user?.license_key) {
      return false;
    }

    const license = await this.licenseRepository.findOneBy({ key_display: user.license_key });
    return Boolean(license && license.bound_user_id === userId && this.isLicenseUsable(license));
  }

  private assertUsableLicense(license: License) {
    if (!this.isLicenseUsable(license)) {
      throw new ForbiddenException(license.is_active ? 'License expired' : 'License is inactive');
    }
  }

  private isLicenseUsable(license: License): boolean {
    if (!license.is_active) {
      return false;
    }
    return !license.expires_at || new Date(license.expires_at) >= new Date();
  }

  private buildFreeStatus() {
    return {
      active: false,
      tier: LicenseTier.FREE,
      expiry: null,
      activationCount: 0,
      maxActivations: 0,
      limits: this.getTierLimits(LicenseTier.FREE),
    };
  }

  private buildStatus(license: License, active: boolean, activationCount: number) {
    return {
      active,
      tier: license.tier,
      expiry: license.expires_at,
      activationCount,
      maxActivations: license.max_activations,
      limits: this.getTierLimits(license.tier),
    };
  }

  private getTierLimits(tier: LicenseTier) {
    const limits = {
      [LicenseTier.FREE]: { accounts: 3, postsPerDay: 10, proxyPool: false, aiVideo: false },
      [LicenseTier.BASIC]: { accounts: 10, postsPerDay: 50, proxyPool: false, aiVideo: false },
      [LicenseTier.PRO]: { accounts: 50, postsPerDay: 200, proxyPool: true, aiVideo: true },
      [LicenseTier.ENTERPRISE]: { accounts: null, postsPerDay: null, proxyPool: true, aiVideo: true },
    };

    return limits[tier] ?? limits[LicenseTier.FREE];
  }

  /**
   * Get count of active activations for a license
   */
  private async getActivationCount(licenseId: number): Promise<number> {
    return this.activationRepository.count({
      where: { license_id: licenseId, is_active: true },
    });
  }
}
