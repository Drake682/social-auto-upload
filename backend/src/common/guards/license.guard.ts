import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { LicenseService } from '../../license/license.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SKIP_LICENSE_KEY } from '../decorators/skip-license.decorator';

@Injectable()
export class LicenseGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly licenseService: LicenseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const skipLicense = this.reflector.getAllAndOverride<boolean>(SKIP_LICENSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skipLicense) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user?.sub) {
      throw new ForbiddenException('License check requires authenticated user');
    }

    const hasAccess = await this.licenseService.validateAccess(user.sub);
    if (!hasAccess) {
      throw new ForbiddenException('Active license required');
    }

    return true;
  }
}
