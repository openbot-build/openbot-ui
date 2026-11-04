import { Match, Schema } from "effect"
import { dual } from "effect/Function"

export const Automation = Schema.Struct({
	id: Schema.String,
	bot: Schema.String,
	prompt: Schema.String,
	schedule: Schema.NullOr(
		Schema.Struct({
			cron: Schema.String,
			timeZone: Schema.optionalKey(Schema.String),
		}),
	),
	webhook: Schema.Boolean,
	enabled: Schema.Boolean,
	needsAuthorization: Schema.optionalKey(Schema.Boolean),
	nextRunAt: Schema.NullOr(Schema.Finite),
	lastFiredAt: Schema.NullOr(Schema.Finite),
	revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
})
export type Automation = typeof Automation.Type
export const decodeAutomations = (input: unknown) =>
	Schema.decodeUnknownSync(Schema.Array(Automation))(input)
export const decodeAutomation = (input: unknown) =>
	Schema.decodeUnknownSync(Automation)(input)

export type Cadence = "daily" | "weekdays" | "weekly" | "custom" | "event"
export interface ScheduleDraft {
	readonly cadence: Cadence
	readonly time: string
	readonly day: string
	readonly timeZone: string
	readonly original: Automation["schedule"]
}

export const scheduleDraft: {
	(schedule: Automation["schedule"], timeZone: string): ScheduleDraft
	(timeZone: string): (schedule: Automation["schedule"]) => ScheduleDraft
} = dual(
	2,
	(schedule: Automation["schedule"], timeZone: string): ScheduleDraft => {
		const basic = {
			time: "09:00",
			day: "1",
			timeZone: schedule === null ? timeZone : (schedule.timeZone ?? "UTC"),
			original: schedule,
		}
		if (schedule === null) return { ...basic, cadence: "event" }
		const fields = schedule.cron.trim().split(/\s+/)
		const minute = fields[0],
			hour = fields[1],
			day = fields[4]
		if (
			fields.length !== 5 ||
			minute === undefined ||
			hour === undefined ||
			!/^\d+$/.test(minute) ||
			!/^\d+$/.test(hour) ||
			Number(minute) > 59 ||
			Number(hour) > 23 ||
			fields[2] !== "*" ||
			fields[3] !== "*"
		)
			return { ...basic, cadence: "custom" }
		const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`
		if (day === "*") return { ...basic, time, cadence: "daily" }
		if (day === "1-5") return { ...basic, time, cadence: "weekdays" }
		if (day !== undefined && /^[0-6]$/.test(day))
			return { ...basic, time, day, cadence: "weekly" }
		return { ...basic, cadence: "custom" }
	},
)

export function scheduleFromDraft(
	draft: ScheduleDraft,
): Automation["schedule"] {
	return Match.value(draft.cadence).pipe(
		Match.when("custom", () => draft.original),
		Match.when("event", () => null),
		Match.orElse((cadence) => {
			if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time))
				throw new Error("Choose a valid time.")
			new Intl.DateTimeFormat("en", { timeZone: draft.timeZone }).format()
			if (cadence === "weekly" && !/^[0-6]$/.test(draft.day))
				throw new Error("Choose a day of the week.")
			const [hour, minute] = draft.time.split(":").map(Number)
			const days =
				cadence === "weekdays" ? "1-5" : cadence === "weekly" ? draft.day : "*"
			return { cron: `${minute} ${hour} * * ${days}`, timeZone: draft.timeZone }
		}),
	)
}
