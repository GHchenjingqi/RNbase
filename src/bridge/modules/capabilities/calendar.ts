/**
 * calendar 桥接模块：日历事件读写。
 */
import type { BridgeServer } from '../../bridge-server';
import { BridgeException } from '../../bridge-error';
import { CapabilityAdapters, requireAdapter, type CalendarEvent } from './types';

export function registerCalendarModule(server: BridgeServer, adapters: CapabilityAdapters): void {
  server.registerModule('calendar', {
    async getCalendars() {
      const adapter = requireAdapter(adapters.calendar, 'calendar');
      return adapter.getCalendars();
    },

    async getEvents(params) {
      const p = params as { calendarId?: string; startDate: number; endDate: number } | undefined;
      if (!p?.startDate || !p?.endDate) {
        throw new BridgeException('INVALID_PARAMS', 'startDate 和 endDate 不能为空');
      }
      const adapter = requireAdapter(adapters.calendar, 'calendar');
      return adapter.getEvents({
        calendarId: p.calendarId,
        startDate: p.startDate,
        endDate: p.endDate,
      });
    },

    async addEvent(params) {
      const p = params as CalendarEvent | undefined;
      if (!p?.title || !p?.startDate || !p?.endDate) {
        throw new BridgeException('INVALID_PARAMS', 'title/startDate/endDate 不能为空');
      }
      const adapter = requireAdapter(adapters.calendar, 'calendar');
      return adapter.addEvent(p);
    },

    async removeEvent(params) {
      const p = params as { id?: string } | undefined;
      if (!p?.id) {
        throw new BridgeException('INVALID_PARAMS', 'id 不能为空');
      }
      const adapter = requireAdapter(adapters.calendar, 'calendar');
      return adapter.removeEvent(p.id);
    },
  });
}
