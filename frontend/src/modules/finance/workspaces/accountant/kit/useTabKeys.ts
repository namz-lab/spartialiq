/**
 * The keyboard of a tab strip or radio group (audit S1), shared by Journals, Parties and BookSwitch:
 * ArrowLeft/ArrowRight (and Up/Down for a radio group) move to the neighbour, wrapping; Home and End go to the
 * first and last. The newly chosen item is selected AND focused, so focus never stays on an item that has
 * just become tabindex -1. Put the returned handler on the container (`@keydown`).
 */
export function useTabKeys<K extends string>(keys: () => readonly K[], current: () => K, select: (k: K) => void, vertical = false) {
  return function onKeydown(e: KeyboardEvent): void {
    const list = keys()
    if (!list.length) return
    const i = Math.max(0, list.indexOf(current()))
    let to = -1
    if (e.key === 'ArrowRight' || (vertical && e.key === 'ArrowDown')) to = (i + 1) % list.length
    else if (e.key === 'ArrowLeft' || (vertical && e.key === 'ArrowUp')) to = (i - 1 + list.length) % list.length
    else if (e.key === 'Home') to = 0
    else if (e.key === 'End') to = list.length - 1
    if (to < 0) return
    e.preventDefault()
    const items = (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="tab"], [role="radio"]')
    select(list[to])
    items[to]?.focus()
  }
}
