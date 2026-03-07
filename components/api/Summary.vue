<script setup lang="ts">
import { sleep } from '#shared/utils/helpers';
import { request } from '#shared/utils/request';
import CodeSegment from '~/components/api/CodeSegment.vue';
import toastFactory from '~/composables/toast';
import type { GetAuthKeyResult } from '~/types/types';

const toast = toastFactory();

const loading = ref(false);
const authKey = ref('');

async function getAuthKey() {
  loading.value = true;
  try {
    await sleep(1000);
    const resp = await request<GetAuthKeyResult>('/api/public/v1/authkey');
    if (resp.code === 0) {
      authKey.value = resp.data;
    } else {
      toast.error('获取密钥失败', resp.msg);
    }
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <section class="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_14px_34px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:bg-slate-900 md:px-6 md:py-6">
    <div class="space-y-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
      <p>
        为了方便第三方开发者做个性化集成，站点将主要能力开放为 API，包括公众号查询、历史文章列表、文章抓取等接口。
      </p>
      <p class="font-medium text-rose-500">
        当前 API 仍可免费使用，但后续可能根据实际负载调整策略。调用量较大时，建议优先做私有部署。
      </p>
    </div>

    <UAlert class="mt-6">
      <template #title>
        <h3 class="flex items-center gap-2 text-lg font-semibold md:text-xl">
          <UIcon name="i-lucide:key-square" />
          <span>认证密钥</span>
        </h3>
      </template>

      <template #description>
        <ol class="list-decimal space-y-3 pl-5 text-sm leading-7 text-slate-600 dark:text-slate-300">
          <li>
            所有未特别说明的 API 都需要携带 `auth-key`。你可以通过自定义请求头
            <code class="font-mono font-medium text-rose-500">X-Auth-Key</code>
            或名为
            <code class="font-mono font-medium text-rose-500">auth-key</code>
            的 Cookie 传递。
          </li>
          <li>
            API 密钥和站点登录态共用同一套认证体系。扫码登录后，接口密钥会自动刷新。
          </li>
          <li>
            当站点登录失效时，对应的 API 密钥也会同时失效。
          </li>
        </ol>

        <UButton class="mt-4" color="blue" :loading="loading" @click="getAuthKey">
          查询 API 密钥
        </UButton>

        <div v-if="authKey" class="mt-5">
          <p class="mb-2 text-sm font-medium">当前密钥</p>
          <CodeSegment :code="authKey" lang="text" class="max-w-xl" />
        </div>
      </template>
    </UAlert>
  </section>
</template>
