import { SetMetadata } from '@nestjs/common';

export const SKIP_LICENSE_KEY = 'skipLicense';
export const SkipLicense = () => SetMetadata(SKIP_LICENSE_KEY, true);
