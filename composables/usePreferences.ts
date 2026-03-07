import { StorageSerializers } from '@vueuse/core';
import { MP_ORIGIN_TIMESTAMP } from '~/config';
import type { Preferences } from '~/types/preferences';

const defaultOptions: Partial<Preferences> = {
  hideDeleted: true,
  privateProxyList: [],
  privateProxyAuthorization: '',
  exportConfig: {
    dirname: '${title}',
    maxlength: 0,
    exportExcelIncludeContent: true,
    exportJsonIncludeComments: true,
    exportJsonIncludeContent: true,
    exportHtmlIncludeComments: true,
  },
  downloadConfig: {
    forceDownloadContent: false,
    metadataOverrideContent: false,
  },
  accountSyncSeconds: 3,
  dailySyncEnabled: false,
  dailySyncTime: '06:00',
  syncDateRange: '1y',
  syncDatePoint: MP_ORIGIN_TIMESTAMP,
};

export default () => {
  //@ts-ignore
  return useLocalStorage<Preferences>('preferences', defaultOptions, {
    serializer: StorageSerializers.object,
    mergeDefaults: true,
  });
};
