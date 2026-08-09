import { CreateEpisodeJob } from "@news-podcast/application"
import type {
  LocalStore,
  ScheduledOwner,
} from "@news-podcast/adapters/db/local"

export class LocalScheduler {
  constructor(private readonly store: LocalStore) {}

  async run(now = new Date()): Promise<number> {
    let created = 0
    for (const owner of this.store.listScheduledOwners()) {
      const local = localClock(now, owner)
      if (
        local.time < owner.schedule.localTime ||
        local.date === owner.lastScheduledLocalDate
      ) {
        continue
      }
      const useCase = new CreateEpisodeJob(this.store, this.store, {
        dispatch: () => Promise.resolve(),
      })
      await useCase.execute({
        ownerId: owner.ownerId,
        idempotencyKey: `scheduled:${local.date}`,
        trigger: "scheduled",
      })
      this.store.markScheduled(owner.ownerId, local.date)
      created += 1
    }
    return created
  }
}

function localClock(now: Date, owner: ScheduledOwner) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: owner.schedule.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return {
    date: `${value.year}-${value.month}-${value.day}`,
    time: `${value.hour}:${value.minute}`,
  }
}
