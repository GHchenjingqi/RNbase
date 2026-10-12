/**
 * contacts 桥接模块：通讯录读写。
 */
import type { BridgeServer } from '../../bridge-server';
import { BridgeException } from '../../bridge-error';
import { CapabilityAdapters, requireAdapter, type Contact } from './types';

export function registerContactsModule(server: BridgeServer, adapters: CapabilityAdapters): void {
  server.registerModule('contacts', {
    async getAll(params) {
      const p = params as { pageSize?: number; page?: number } | undefined;
      const adapter = requireAdapter(adapters.contacts, 'contacts');
      return adapter.getAll({ pageSize: p?.pageSize, page: p?.page });
    },

    async pick() {
      const adapter = requireAdapter(adapters.contacts, 'contacts');
      const contact = await adapter.pick();
      if (!contact) {
        throw new BridgeException('USER_CANCELLED', '未选择联系人');
      }
      return contact;
    },

    async add(params) {
      const p = params as Omit<Contact, 'id'> | undefined;
      if (!p?.name) {
        throw new BridgeException('INVALID_PARAMS', 'name 不能为空');
      }
      const adapter = requireAdapter(adapters.contacts, 'contacts');
      return adapter.add(p);
    },
  });
}
