export const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'dev_access_secret_key_change_in_production';
export const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret_key_change_in_production';

export const ACCESS_TOKEN_EXPIRY = '15m';
export const ACCESS_TOKEN_EXPIRES_IN_SECONDS = 15 * 60;
export const REFRESH_TOKEN_EXPIRY = '7d';

export const ARGON2_OPTIONS = {
  timeCost: 3,
  memoryCost: 65536,
  parallelism: 4,
};
