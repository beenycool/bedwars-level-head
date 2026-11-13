import { ADMIN_API_KEYS } from '../config';
import { createTokenAuth } from './tokenAuth';

const adminAuth = createTokenAuth({
  keys: ADMIN_API_KEYS,
  headerName: 'x-admin-token',
  label: 'admin API token',
});

export const extractAdminToken = adminAuth.extract;
export const validateAdminToken = adminAuth.validate;
export const enforceAdminAuth = adminAuth.enforce;
export const initAllowedKeyHashes = adminAuth.init;
