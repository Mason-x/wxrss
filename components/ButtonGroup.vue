<template>
  <UDropdown :items="items" :popper="dropdownPopper" :ui="{ container: 'z-50' }">
    <slot>
      <UButton color="white" label="导出" trailing-icon="i-heroicons-chevron-down-20-solid" />
    </slot>
  </UDropdown>
</template>

<script setup lang="ts">
const emit = defineEmits();

interface Item {
  label: string;
  event: string;
  disabled?: boolean;
}

interface DropdownPopper {
  placement?: string;
  strategy?: 'absolute' | 'fixed';
  overflowPadding?: number;
  offsetDistance?: number;
  offsetSkid?: number;
}

interface Props {
  items: Item[];
  popper?: DropdownPopper;
}

const props = defineProps<Props>();

const dropdownPopper = computed(() => ({
  placement: 'bottom-end',
  strategy: 'absolute',
  overflowPadding: 12,
  ...props.popper,
}));

const items = [
  props.items.map(item => ({
    label: item.label,
    click() {
      emit(item.event);
    },
    disabled: item.disabled,
  })),
];
</script>
