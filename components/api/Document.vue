<script setup lang="ts">
import CodeSegment from '~/components/api/CodeSegment.vue';

interface TParam {
  name: string;
  location: string;
  label: string;
  required: boolean;
  default: string;
  type: string;
  remark: string;
}

interface Props {
  index: number;
  name: string;
  description: string;
  url: string;
  method: string;
  params: TParam[];
  responseSample: any;
  remark?: string;
}

defineProps<Props>();

const open = ref(false);
const host = computed(() => {
  if (!import.meta.client) {
    return '';
  }
  return `${window.location.protocol}//${window.location.host}`;
});
</script>

<template>
  <section class="space-y-5 rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_14px_34px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:bg-slate-900 md:px-6 md:py-6">
    <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <h2 class="text-xl font-semibold md:text-2xl">{{ index }}. {{ name }}</h2>
      <ApiDebugModal :initial-selected="name" />
    </div>

    <div>
      <p class="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">简要描述</p>
      <p class="text-sm leading-7 text-slate-600 dark:text-slate-300">{{ description }}</p>
    </div>

    <div v-if="remark">
      <p class="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">备注</p>
      <p class="text-sm leading-7 text-rose-500">{{ remark }}</p>
    </div>

    <div>
      <p class="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">请求 URL</p>
      <div class="overflow-x-auto rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60">
        <p class="min-w-max font-mono text-sm">
          <span class="text-slate-400">{{ host }}</span>
          <span class="font-semibold text-slate-700 dark:text-slate-200">{{ url }}</span>
        </p>
      </div>
    </div>

    <div>
      <p class="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">请求方式</p>
      <div class="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60">
        <p class="font-mono text-sm">{{ method }}</p>
      </div>
    </div>

    <div>
      <p class="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">参数</p>
      <div class="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
        <table class="min-w-[760px] text-left text-sm">
          <thead class="bg-slate-50 text-slate-500 dark:bg-slate-950/60 dark:text-slate-400">
            <tr>
              <th>参数名</th>
              <th>位置</th>
              <th>必填</th>
              <th>默认值</th>
              <th>类型</th>
              <th>说明</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in params" :key="p.name" class="border-t border-slate-200 dark:border-slate-800">
              <td>{{ p.name }}</td>
              <td>{{ p.location }}</td>
              <td>{{ p.required ? '是' : '否' }}</td>
              <td>{{ p.default || '--' }}</td>
              <td>{{ p.type }}</td>
              <td>{{ p.label }}</td>
              <td>{{ p.remark || '--' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div>
      <p class="mb-2 flex items-center gap-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
        <span>返回示例</span>
        <UToggle v-model="open" color="blue" on-icon="i-heroicons:eye" off-icon="i-heroicons:eye-slash" />
      </p>
      <CodeSegment v-if="open" :code="responseSample" lang="json" />
    </div>
  </section>
</template>

<style scoped>
th,
td {
  padding: 0.75rem;
  white-space: nowrap;
}

td:nth-child(6),
td:nth-child(7) {
  white-space: normal;
  min-width: 10rem;
}
</style>
