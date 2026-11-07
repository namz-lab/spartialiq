import { defineStore } from 'pinia'

export const useCouncilStore = defineStore('council', {
  state: () => ({
    selectedCouncil: {
      name: 'Vungu Rural District Council',
      shortName: 'Vungu RDC',
      province: 'Midlands',
    } as { name: string; shortName: string; province: string } | null,
  }),
})
