import { keigoLabels } from '../../data/mock'
import { useStore } from '../../store'
import type { Keigo } from '../../types'
import { Segmented } from '../../components/ui'

export function ContactsView() {
  const { contacts, setContacts } = useStore()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-3">
        <h2 className="text-[15px] font-semibold">Người liên hệ</h2>
        <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11.5px] font-semibold text-warn">v1</span>
        <div className="flex-1" />
        <span className="text-[12.5px] text-ink-3">Mức kính ngữ ở đây được dùng mặc định khi trả lời người đó</span>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-5">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
          {contacts.map((c) => (
            <div key={c.id} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-full bg-accent-soft text-[15px] font-semibold text-accent">
                  {c.name.slice(0, 1)}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-semibold">{c.name}</div>
                  <div className="truncate text-[12.5px] text-ink-2">
                    {c.role} · {c.company}
                  </div>
                </div>
              </div>
              <Segmented
                label={`Mức kính ngữ với ${c.name}`}
                value={c.keigo}
                onChange={(k: Keigo) => setContacts(contacts.map((x) => (x.id === c.id ? { ...x, keigo: k } : x)))}
                options={(['casual', 'polite', 'formal'] as const).map((k) => ({ value: k, label: keigoLabels[k] }))}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
