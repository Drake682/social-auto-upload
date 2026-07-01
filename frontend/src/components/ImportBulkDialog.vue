<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-header">
        <h2>Import Accounts</h2>
        <button class="btn-close" @click="$emit('close')">✕</button>
      </div>

      <form class="modal-body" @submit.prevent="submit">
        <div class="form-group">
          <label for="format">Format</label>
          <select id="format" v-model="format">
            <option value="json">JSON array</option>
            <option value="csv">CSV</option>
          </select>
        </div>

        <div class="form-group">
          <label for="payload">Payload</label>
          <textarea
            id="payload"
            v-model="payload"
            rows="10"
            :placeholder="placeholder"
            required
          ></textarea>
        </div>

        <div v-if="error" class="error-message">{{ error }}</div>

        <div v-if="result" class="result-box">
          <strong>Import result:</strong>
          {{ result.success }} success, {{ result.failed }} failed / {{ result.total }} total
          <ul v-if="result.errors.length">
            <li v-for="item in result.errors" :key="`${item.row}-${item.reason}`">
              Row {{ item.row }}: {{ item.reason }}
            </li>
          </ul>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn-cancel" @click="$emit('close')">Close</button>
          <button type="submit" class="btn-submit" :disabled="isSubmitting">
            {{ isSubmitting ? 'Importing...' : 'Import' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useAccountStore, type BulkImportResult } from '@/stores/account.store';

const emit = defineEmits<{ close: []; imported: [] }>();
const store = useAccountStore();

const format = ref<'json' | 'csv'>('json');
const payload = ref('');
const error = ref('');
const result = ref<BulkImportResult | null>(null);
const isSubmitting = ref(false);

const placeholder = computed(() =>
  format.value === 'json'
    ? '[{"platform":"facebook","account_name":"Page","session_data":{"cookies":[]}}]'
    : 'platform,account_name,session_data\nfacebook,Page,"{""cookies"":[]}"',
);

async function submit() {
  error.value = '';
  result.value = null;
  isSubmitting.value = true;

  const response = await store.importBulk(format.value, payload.value);
  isSubmitting.value = false;

  if (response.success && response.result) {
    result.value = response.result;
    emit('imported');
    return;
  }

  error.value = response.message || 'Import failed';
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal {
  background: rgba(30, 41, 59, 0.98);
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 14px;
  width: 100%;
  max-width: 620px;
  box-shadow: 0 25px 60px rgba(0, 0, 0, 0.6);
}

.modal-header,
.modal-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.modal-header {
  padding: 20px 24px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.08);
}

.modal-header h2 { margin: 0; color: #f1f5f9; font-size: 18px; }
.modal-body { padding: 24px; }
.form-group { margin-bottom: 18px; }
.form-group label { display: block; color: #cbd5e1; font-size: 13px; margin-bottom: 6px; }
.form-group select,
.form-group textarea {
  width: 100%;
  padding: 10px 14px;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.15);
  border-radius: 8px;
  color: #f1f5f9;
  font-family: inherit;
}
.form-group textarea { font-family: 'Courier New', monospace; font-size: 13px; }
.error-message,
.result-box {
  padding: 10px 14px;
  border-radius: 8px;
  margin-bottom: 16px;
  font-size: 13px;
}
.error-message { background: rgba(239, 68, 68, 0.08); color: #fca5a5; }
.result-box { background: rgba(34, 197, 94, 0.08); color: #bbf7d0; }
.result-box ul { margin: 8px 0 0 18px; color: #fca5a5; }
.btn-close,
.btn-cancel,
.btn-submit { cursor: pointer; border-radius: 8px; }
.btn-close { width: 28px; height: 28px; border: none; background: rgba(148, 163, 184, 0.1); color: #94a3b8; }
.btn-cancel { padding: 10px 20px; background: rgba(148, 163, 184, 0.08); border: 1px solid rgba(148, 163, 184, 0.15); color: #94a3b8; }
.btn-submit { padding: 10px 20px; background: #2563eb; border: none; color: white; font-weight: 600; }
.btn-submit:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
