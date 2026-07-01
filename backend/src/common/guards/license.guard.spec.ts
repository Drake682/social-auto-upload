import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { LicenseGuard } from './license.guard';
import { LicenseService } from '../../license/license.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SKIP_LICENSE_KEY } from '../decorators/skip-license.decorator';

describe('LicenseGuard', () => {
  let guard: LicenseGuard;
  let reflector: jest.Mocked<Reflector>;
  let licenseService: jest.Mocked<Pick<LicenseService, 'validateAccess'>>;

  const buildContext = (user?: any) => ({
    getHandler: jest.fn(() => 'handler'),
    getClass: jest.fn(() => 'class'),
    switchToHttp: jest.fn(() => ({
      getRequest: jest.fn(() => ({ user })),
    })),
  } as any);

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as any;
    licenseService = {
      validateAccess: jest.fn(),
    };
    guard = new LicenseGuard(reflector, licenseService as any);
  });

  it('allows public routes without license check', async () => {
    reflector.getAllAndOverride.mockImplementation((key) => key === IS_PUBLIC_KEY);

    await expect(guard.canActivate(buildContext())).resolves.toBe(true);
    expect(licenseService.validateAccess).not.toHaveBeenCalled();
  });

  it('allows routes marked SkipLicense without license check', async () => {
    reflector.getAllAndOverride.mockImplementation((key) => key === SKIP_LICENSE_KEY);

    await expect(guard.canActivate(buildContext({ sub: 7 }))).resolves.toBe(true);
    expect(licenseService.validateAccess).not.toHaveBeenCalled();
  });

  it('allows protected route when current user has active license', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    licenseService.validateAccess.mockResolvedValue(true);

    await expect(guard.canActivate(buildContext({ sub: 7 }))).resolves.toBe(true);
    expect(licenseService.validateAccess).toHaveBeenCalledWith(7);
  });

  it('blocks protected route when current user has no active license', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    licenseService.validateAccess.mockResolvedValue(false);

    await expect(guard.canActivate(buildContext({ sub: 7 }))).rejects.toThrow(ForbiddenException);
  });
});
