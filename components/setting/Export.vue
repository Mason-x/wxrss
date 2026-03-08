<template>
  <UCard class="app-shell-panel h-full overflow-hidden rounded-[30px]" :ui="cardUi">
    <template #header>
      <h3 class="text-xl font-semibold md:text-2xl">导出选项</h3>
      <p class="text-sm text-slate-500">配置文章导出时的目录规则和内容包含策略。</p>
    </template>

    <div class="space-y-5">
      <div class="app-shell-muted rounded-[26px] p-4 sm:p-5">
        <p class="mb-2 flex items-center gap-2">
          <span class="text-sm font-medium">导出目录名</span>
          <UPopover mode="hover" :popper="{ placement: 'bottom-start' }">
            <UButton color="white" size="sm" class="rounded-full" trailing-icon="i-heroicons:variable-16-solid" />

            <template #panel>
              <div class="w-[min(42rem,88vw)] overflow-x-auto p-4">
                <p class="mb-3 font-medium">支持的变量</p>
                <table class="min-w-full border-collapse border">
                  <tbody>
                    <tr>
                      <th class="w-20">变量</th>
                      <th class="w-32">含义</th>
                      <th class="w-20">变量</th>
                      <th class="w-32">含义</th>
                    </tr>
                    <tr v-for="(item, idx) in variables" :key="idx">
                      <td class="text-center">{{ item[0].name }}</td>
                      <td class="text-center">{{ item[0].description }}</td>
                      <td class="text-center">{{ item[1].name }}</td>
                      <td class="text-center">{{ item[1].description }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
          </UPopover>
        </p>
        <p class="mb-2 text-sm text-slate-500">影响 `html / txt / markdown / word / pdf` 的导出目录。</p>
        <UInput
          v-model="preferences.exportConfig.dirname"
          placeholder="例如：{{account}}/{{YYYY}}-{{MM}}/{{title}}"
          class="w-full font-mono md:max-w-2xl"
          name="dirname"
        />
      </div>

      <div class="app-shell-muted rounded-[26px] p-4 sm:p-5">
        <p class="text-sm font-medium">目录名最大长度</p>
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
          <UInput
            v-model="preferences.exportConfig.maxlength"
            type="number"
            min="0"
            placeholder="0 表示不限制"
            class="w-full sm:w-40"
          />
          <span class="text-xs text-slate-500">设置为 0 表示不限制长度。</span>
        </div>
      </div>

      <div class="app-shell-muted rounded-[26px] p-4 sm:p-5">
        <UCheckbox
          v-model="preferences.exportConfig.exportExcelIncludeContent"
          name="exportExcelIncludeContent"
          label="导出 Excel 时包含文章正文"
        />

        <UCheckbox
          v-model="preferences.exportConfig.exportJsonIncludeContent"
          name="exportJsonIncludeContent"
          label="导出 JSON 时包含文章正文"
        />

        <UCheckbox
          v-model="preferences.exportConfig.exportJsonIncludeComments"
          name="exportJsonIncludeComments"
          label="导出 JSON 时包含留言数据"
        />

        <UCheckbox
          v-model="preferences.exportConfig.exportHtmlIncludeComments"
          name="exportHtmlIncludeComments"
          label="导出 HTML 时包含留言数据"
        />
      </div>
    </div>
  </UCard>
</template>

<script setup lang="ts">
import type { Preferences } from '~/types/preferences';

const preferences: Ref<Preferences> = usePreferences() as unknown as Ref<Preferences>;
const cardUi = {
  ring: '',
  divide: 'divide-y divide-slate-200/70 dark:divide-slate-800/80',
  header: { padding: 'px-5 pb-0 pt-5 sm:px-6 sm:pt-6' },
  body: { padding: 'px-5 pb-5 pt-5 sm:px-6 sm:pb-6 sm:pt-5' },
};

const _variables = [
  { name: 'account', description: '公众号名称' },
  { name: 'title', description: '文章标题' },
  { name: 'aid', description: '文章 id' },
  { name: 'author', description: '作者' },
  { name: 'YYYY', description: '年' },
  { name: 'MM', description: '月' },
  { name: 'DD', description: '日' },
  { name: 'HH', description: '时' },
  { name: 'mm', description: '分' },
];

const variables = Array.from({ length: Math.ceil(_variables.length / 2) }, (_, i) => [
  _variables[i * 2] ?? {},
  _variables[i * 2 + 1] ?? {},
]);
</script>

<style scoped>
table th {
  padding: 0.55rem 0.4rem;
}

table td {
  border: 1px solid rgb(226 232 240 / 0.72);
  padding: 0.45rem 0.6rem;
}

td:first-child,
th:first-child {
  border-left: none;
}

td:last-child,
th:last-child {
  border-right: none;
}

th {
  border: 1px solid rgb(226 232 240 / 0.72);
  border-top: none;
  background: rgb(255 255 255 / 0.78);
}

tr:nth-child(even) {
  background-color: rgb(248 250 252 / 0.72);
}

tr:hover {
  background-color: rgb(241 245 249 / 0.88);
}

:global(html.dark) table td,
:global(html.dark) table th {
  border-color: rgb(51 65 85 / 0.7);
}

:global(html.dark) table th {
  background: rgb(15 23 42 / 0.72);
}

:global(html.dark) tr:nth-child(even) {
  background-color: rgb(15 23 42 / 0.24);
}

:global(html.dark) tr:hover {
  background-color: rgb(30 41 59 / 0.42);
}
</style>
