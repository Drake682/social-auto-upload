import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '@/api';

export type Platform = 'tiktok' | 'tiktok_vn' | 'tiktok_us' | 'facebook' | 'youtube' | 'instagram' | 'shopee';
export type AccountStatus = 'active' | 'dead' | 'checking';

export interface SocialAccount {
  id: number;
  platform: Platform;
  account_name: string;
  status: AccountStatus;
  last_health_check: string | null;
  created_at: string;
  updated_at: string;
  user_id: number;
}

export interface AddAccountPayload {
  platform: Platform;
  account_name: string;
  session_data: Record<string, any>;
}

export interface BulkImportResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ row: number; reason: string }>;
}

export const useAccountStore = defineStore('accounts', () => {
  const accounts = ref<SocialAccount[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const platformFilter = ref<Platform | ''>('');
  const page = ref(1);
  const limit = ref(20);
  const total = ref(0);
  const totalPages = ref(1);

  async function fetchAccounts() {
    isLoading.value = true;
    error.value = null;

    try {
      const response = await api.get('/accounts', {
        params: {
          page: page.value,
          limit: limit.value,
          ...(platformFilter.value ? { platform: platformFilter.value } : {}),
        },
      });
      accounts.value = response.data.data.items;
      total.value = response.data.data.meta.total;
      totalPages.value = response.data.data.meta.totalPages || 1;
    } catch (err: any) {
      error.value = err.response?.data?.msg || err.response?.data?.message || 'Failed to load accounts';
    } finally {
      isLoading.value = false;
    }
  }

  async function setPlatformFilter(platform: Platform | '') {
    platformFilter.value = platform;
    page.value = 1;
    await fetchAccounts();
  }

  async function setPage(nextPage: number) {
    page.value = Math.min(Math.max(nextPage, 1), totalPages.value || 1);
    await fetchAccounts();
  }

  async function addAccount(payload: AddAccountPayload) {
    isLoading.value = true;
    error.value = null;

    try {
      const response = await api.post('/accounts', payload);
      const newAccount: SocialAccount = response.data.data;
      accounts.value.unshift(newAccount);
      return { success: true, account: newAccount };
    } catch (err: any) {
      const message = err.response?.data?.msg || err.response?.data?.message || 'Failed to add account';
      error.value = message;
      return { success: false, message };
    } finally {
      isLoading.value = false;
    }
  }

  async function importBulk(format: 'json' | 'csv', payload: string) {
    error.value = null;

    try {
      const body = format === 'json'
        ? { format, accounts: JSON.parse(payload) }
        : { format, csv: payload };
      const response = await api.post('/accounts/import-bulk', body);
      await fetchAccounts();
      return { success: true, result: response.data.data as BulkImportResult };
    } catch (err: any) {
      const message = err.response?.data?.msg || err.response?.data?.message || err.message || 'Failed to import accounts';
      error.value = message;
      return { success: false, message };
    }
  }

  async function deleteAccount(id: number) {
    error.value = null;

    try {
      await api.delete(`/accounts/${id}`);
      accounts.value = accounts.value.filter((a) => a.id !== id);
      total.value = Math.max(total.value - 1, 0);
      return { success: true };
    } catch (err: any) {
      const message = err.response?.data?.msg || err.response?.data?.message || 'Failed to delete account';
      error.value = message;
      return { success: false, message };
    }
  }

  async function checkHealth(id: number) {
    error.value = null;

    try {
      const account = accounts.value.find((a) => a.id === id);
      if (account) account.status = 'checking';

      const response = await api.get(`/accounts/${id}/health`);
      const health = response.data.data as { alive: boolean | null; checked_at: string };

      const index = accounts.value.findIndex((a) => a.id === id);
      if (index !== -1) {
        accounts.value[index] = {
          ...accounts.value[index],
          status: health.alive === true ? 'active' : health.alive === false ? 'dead' : 'checking',
          last_health_check: health.checked_at,
        };
      }

      return { success: true, health };
    } catch (err: any) {
      const message = err.response?.data?.msg || err.response?.data?.message || 'Health check failed';
      error.value = message;
      return { success: false, message };
    }
  }

  return {
    accounts,
    isLoading,
    error,
    platformFilter,
    page,
    limit,
    total,
    totalPages,
    fetchAccounts,
    setPlatformFilter,
    setPage,
    addAccount,
    importBulk,
    deleteAccount,
    checkHealth,
  };
});
