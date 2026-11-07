import api from './api'
import type {
  CorrespondenceEntry, FeeReceipt, AcknowledgementLetter,
  PermitDispatch, RefusalLetter, NoticeCertificate, AbutterNotificationLog,
} from '@/composables/usePlanningClerkCase'

function data<T>(r: { data?: { data?: T } }): T {
  const body = r.data as { data?: T } | undefined
  if (!body || body.data === undefined) throw new Error('The server returned an empty response.')
  return body.data
}

export const planningClerkApi = {
  listCorrespondence(params?: { permit_application_id?: string; limit?: number }) {
    return api.get('/clerk/correspondence', { params }).then((r) => data<CorrespondenceEntry[]>(r))
  },
  createCorrespondence(body: Omit<CorrespondenceEntry, 'id'>) {
    return api.post('/clerk/correspondence', body).then((r) => data<CorrespondenceEntry>(r))
  },
  listFeeReceipts(params?: { permit_application_id?: string; limit?: number }) {
    return api.get('/clerk/fee-receipts', { params }).then((r) => data<FeeReceipt[]>(r))
  },
  createFeeReceipt(body: Omit<FeeReceipt, 'id'>) {
    return api.post('/clerk/fee-receipts', body).then((r) => data<FeeReceipt>(r))
  },
  listAcknowledgements(params?: { permit_application_id?: string; overdue?: boolean; limit?: number }) {
    return api.get('/clerk/acknowledgements', { params }).then((r) => data<AcknowledgementLetter[]>(r))
  },
  createAcknowledgement(body: Omit<AcknowledgementLetter, 'id'>) {
    return api.post('/clerk/acknowledgements', body).then((r) => data<AcknowledgementLetter>(r))
  },
  markAcknowledgementSent(id: string) {
    return api.patch(`/clerk/acknowledgements/${id}/mark-sent`).then((r) => data<AcknowledgementLetter>(r))
  },
  listDispatches(params?: { permit_application_id?: string; limit?: number }) {
    return api.get('/clerk/dispatches', { params }).then((r) => data<PermitDispatch[]>(r))
  },
  createDispatch(body: Omit<PermitDispatch, 'id'>) {
    return api.post('/clerk/dispatches', body).then((r) => data<PermitDispatch>(r))
  },
  listRefusals(params?: { permit_application_id?: string; overdue?: boolean; limit?: number }) {
    return api.get('/clerk/refusals', { params }).then((r) => data<RefusalLetter[]>(r))
  },
  createRefusal(body: Omit<RefusalLetter, 'id'>) {
    return api.post('/clerk/refusals', body).then((r) => data<RefusalLetter>(r))
  },
  markRefusalSent(id: string) {
    return api.patch(`/clerk/refusals/${id}/mark-sent`).then((r) => data<RefusalLetter>(r))
  },
  listNoticeCertificates(params?: { permit_application_id?: string; limit?: number }) {
    return api.get('/clerk/notice-certificates', { params }).then((r) => data<NoticeCertificate[]>(r))
  },
  createNoticeCertificate(body: Omit<NoticeCertificate, 'id'>) {
    return api.post('/clerk/notice-certificates', body).then((r) => data<NoticeCertificate>(r))
  },
  listAbutterNotifications(params?: { permit_application_id?: string; limit?: number }) {
    return api.get('/clerk/abutter-notifications', { params }).then((r) => data<AbutterNotificationLog[]>(r))
  },
  createAbutterNotification(body: Omit<AbutterNotificationLog, 'id'>) {
    return api.post('/clerk/abutter-notifications', body).then((r) => data<AbutterNotificationLog>(r))
  },
  async loadAll() {
    const [correspondence, receipts, acknowledgements, dispatches, refusals, noticeCertificates, abutterLog] =
      await Promise.all([
        planningClerkApi.listCorrespondence(),
        planningClerkApi.listFeeReceipts(),
        planningClerkApi.listAcknowledgements(),
        planningClerkApi.listDispatches(),
        planningClerkApi.listRefusals(),
        planningClerkApi.listNoticeCertificates(),
        planningClerkApi.listAbutterNotifications(),
      ])
    return { correspondence, receipts, acknowledgements, dispatches, refusals, noticeCertificates, abutterLog }
  },
}
