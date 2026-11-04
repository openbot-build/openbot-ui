import { t } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import type * as Product from "@kaicom/kay-contracts"
import { RequestFailed } from "@kaicom/kay-contracts/Client"
import { Match, Schema } from "effect"
import { useCallback, useEffect, useId, useRef, useState } from "react"
import {
	ArrowUpRight,
	Cloud,
	Laptop,
	Plus,
	RefreshCw,
	Smartphone,
	Speaker,
} from "lucide-react"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "../../components/ui/dialog"
import { PageHeading } from "../Shell"
import { ComputersPage, computerStateLabel } from "./ComputersPage"
import { ComputerPairing, WorkspaceComputer } from "./ComputersData"
import {
	useWorkspaceWorkflow,
	WorkflowNotice,
	type WorkflowProps,
} from "./Workflow"
import "./DevicesPage.css"

const categories: ReadonlyArray<Product.DeviceCategory> = [
	"computer",
	"phone",
	"smart",
]
const categoryName = (category: Product.DeviceCategory) =>
	Match.value(category).pipe(
		Match.when("computer", () => t`Computers`),
		Match.when("phone", () => t`Phones`),
		Match.when("smart", () => t`Smart devices`),
		Match.exhaustive,
	)
const categoryIcon = (category: Product.DeviceCategory) =>
	Match.value(category).pipe(
		Match.when("computer", () => Laptop),
		Match.when("phone", () => Smartphone),
		Match.when("smart", () => Speaker),
		Match.exhaustive,
	)
const groupLayout = (category: Product.DeviceCategory) =>
	Match.value(category).pipe(
		Match.when("smart", () => "device-workspace-grid"),
		Match.orElse(() => "device-workspace-row"),
	)
const accessLabel = (access: Product.DeviceSummary["kayAccess"]) =>
	Match.value(access).pipe(
		Match.when("granted", () => t`Kay has access`),
		Match.when("not_granted", () => t`Kay access not granted`),
		Match.when("unconfigured", () => t`Kay access is not configured`),
		Match.exhaustive,
	)
const managementLabel = (management: Product.DeviceSummary["management"]) =>
	Match.value(management).pipe(
		Match.when("personal", () => t`Your device`),
		Match.when("shared", () => t`Shared computer`),
		Match.when("managed", () => t`Basic task space`),
		Match.exhaustive,
	)
const connectionReason = (
	reason: Exclude<Product.DeviceConnectionAvailability["reason"], null>,
) =>
	Match.value(reason).pipe(
		Match.when(
			"mobile_connector_unavailable",
			() => t`Phone connections are not available in this workspace.`,
		),
		Match.when(
			"smart_device_adapter_unavailable",
			() =>
				t`Direct smart device connections are not available in this workspace.`,
		),
		Match.exhaustive,
	)
const capabilityLabels = (capabilities: Product.DeviceCapabilities) =>
	[
		{ available: capabilities.files, label: t`Files` },
		{ available: capabilities.commands, label: t`Terminal` },
		{ available: capabilities.desktop, label: t`Desktop` },
		{ available: capabilities.ports, label: t`Ports` },
	]
		.filter((capability) => capability.available)
		.map((capability) => capability.label)

type DevicesPageProps = WorkflowProps & {
	readonly onNavigateFeature: (id: string) => void
}

export function DevicesPage(props: DevicesPageProps) {
	const [selected, setSelected] = useState<{
		readonly id: string
		readonly managed: boolean
	} | null>(null)
	return selected === null ? (
		<DevicesOverview
			{...props}
			onOpenComputer={(id, managed) => setSelected({ id, managed })}
		/>
	) : (
		<ComputersPage
			key={selected.id}
			{...props}
			initialComputerId={selected.id}
			initialComputerManaged={selected.managed}
			onBackToDevices={() => setSelected(null)}
		/>
	)
}

function DevicesOverview(
	props: DevicesPageProps & {
		readonly onOpenComputer: (id: string, managed: boolean) => void
	},
) {
	const { i18n } = useLingui()
	const { client } = props
	const workflow = useWorkspaceWorkflow(props)
	const [overview, setOverview] = useState<Product.DevicesOverview | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [connecting, setConnecting] = useState(false)
	const [code, setCode] = useState("")
	const [name, setName] = useState("")
	const [pairing, setPairing] = useState<ComputerPairing | null>(null)
	const [checking, setChecking] = useState(false)
	const [notice, setNotice] = useState<string | null>(null)
	const request = useRef<AbortController | null>(null)
	const pairingRequest = useRef<AbortController | null>(null)
	const connectTrigger = useRef<HTMLElement | null>(null)
	const fieldId = useId()
	const blocked = workflow.busy || workflow.unconfirmed !== null
	const canPair =
		!workflow.preview &&
		workflow.ready &&
		workflow.can("computers.getComputerPairing") &&
		workflow.can("computers.approveComputerPairing")
	const refresh = useCallback(async () => {
		request.current?.abort()
		const next = new AbortController()
		request.current = next
		setLoading(true)
		setError(null)
		if (client === undefined) {
			setLoading(false)
			setError(t`Connect to your workspace to see your devices.`)
			return
		}
		try {
			const value = await client.devices(next.signal)
			if (!next.signal.aborted) setOverview(value)
		} catch (failure) {
			if (!next.signal.aborted) {
				if (
					failure instanceof RequestFailed &&
					[401, 403, 404].includes(failure.status)
				) {
					pairingRequest.current?.abort()
					setOverview(null)
					setPairing(null)
					setConnecting(false)
					setChecking(false)
					setCode("")
					setName("")
					setNotice(null)
				}
				setError(
					failure instanceof Error
						? failure.message
						: t`Your devices could not be loaded. Try again.`,
				)
			}
		} finally {
			if (!next.signal.aborted) setLoading(false)
		}
	}, [client])
	useEffect(() => {
		void refresh()
		return () => {
			request.current?.abort()
			pairingRequest.current?.abort()
		}
	}, [refresh])
	const reviewAndRefresh = async () => {
		if (
			workflow.unconfirmed !== null &&
			workflow.can("computers.listComputers")
		) {
			try {
				await workflow.read("computers.listComputers")
			} catch {
				// Only a successful resource read enables receipt acknowledgement.
			}
		}
		await refresh()
	}
	const beginPairing = (trigger: HTMLElement) => {
		connectTrigger.current = trigger
		setCode("")
		setName("")
		setPairing(null)
		setNotice(null)
		setConnecting(true)
	}
	const closePairing = () => {
		pairingRequest.current?.abort()
		setChecking(false)
		setConnecting(false)
		setPairing(null)
	}
	const checkPairing = async () => {
		if (!canPair || code.trim() === "" || blocked) return
		pairingRequest.current?.abort()
		const next = new AbortController()
		pairingRequest.current = next
		setChecking(true)
		setPairing(null)
		try {
			const value = Schema.decodeUnknownSync(ComputerPairing)(
				await workflow.read(
					"computers.getComputerPairing",
					{ params: { code: code.trim() } },
					next.signal,
				),
			)
			if (!next.signal.aborted) {
				setPairing(value)
				setName(value.hostname)
			}
		} catch {
			// The workflow displays the failed lookup and keeps the code editable.
		} finally {
			if (!next.signal.aborted) setChecking(false)
		}
	}
	const approvePairing = async () => {
		if (
			pairing === null ||
			!canPair ||
			blocked ||
			pairing.expiresAt <= Date.now()
		)
			return
		try {
			const value = Schema.decodeUnknownSync(WorkspaceComputer)(
				await workflow.call("computers.approveComputerPairing", {
					params: { code: pairing.code },
					payload: { name: name.trim() || pairing.hostname },
				}),
			)
			closePairing()
			setNotice(t`Device connected. Keep the connector running on your device.`)
			await refresh()
			if (request.current?.signal.aborted === false)
				props.onOpenComputer(value.id, false)
		} catch {
			// A failed or unconfirmed pairing stays in the existing receipt workflow.
		}
	}
	return (
		<section className="device-workspace workflow-page">
			<PageHeading
				title={t`Devices`}
				description={t`Your computers, phones, and smart devices in one place.`}
			>
				<div className="device-workspace-actions">
					<Button
						variant="ghost"
						onClick={() => props.onNavigateFeature("computers")}
					>
						{t`Manage computers`}
						<ArrowUpRight size={16} />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						aria-label={t`Refresh devices`}
						disabled={loading}
						onClick={() => void reviewAndRefresh()}
					>
						<RefreshCw size={18} />
					</Button>
				</div>
			</PageHeading>
			<WorkflowNotice workflow={workflow} />
			{error !== null && (
				<p className="workflow-notice" role="alert">
					{error}
				</p>
			)}
			{notice !== null && (
				<p className="device-workspace-notice" role="status">
					{notice}
				</p>
			)}
			{loading && overview === null && (
				<p role="status">{t`Loading your devices…`}</p>
			)}
			<div className="device-workspace-sections">
				{categories.map((category) => {
					const group = overview?.groups.find(
						(item) => item.category === category,
					)
					const Icon = categoryIcon(category)
					return (
						<section
							className="device-workspace-section"
							key={category}
							aria-labelledby={`${fieldId}-${category}`}
						>
							<header>
								<h2 id={`${fieldId}-${category}`}>{categoryName(category)}</h2>
								{group !== undefined && <span>{group.devices.length}</span>}
							</header>
							<div className={groupLayout(category)}>
								{group?.devices.map((device) => {
									const DeviceIcon = Match.value(device.source).pipe(
										Match.when("connector", () => Laptop),
										Match.when("provider", () => Cloud),
										Match.exhaustive,
									)
									return (
										<button
											type="button"
											className="device-workspace-card"
											key={device.id}
											onClick={() =>
												props.onOpenComputer(
													device.id,
													device.management === "managed",
												)
											}
										>
											<DeviceIcon
												className="device-workspace-picture"
												strokeWidth={1.1}
												aria-hidden="true"
											/>
											<span
												className="device-workspace-state"
												data-state={device.state}
											>
												<i />
												{computerStateLabel(device.state)}
											</span>
											<span className="device-workspace-name">
												{device.name}
												<ArrowUpRight size={16} aria-hidden="true" />
											</span>
											<span className="device-workspace-meta">
												{managementLabel(device.management)} ·{" "}
												{accessLabel(device.kayAccess)}
											</span>
											<span className="device-workspace-meta">
												{capabilityLabels(device.capabilities).join(" · ") ||
													t`No device controls available`}
											</span>
											{device.lastActiveAt !== null && (
												<span className="device-workspace-meta">
													{t`Last active`}{" "}
													{new Intl.DateTimeFormat(i18n.locale, {
														dateStyle: "short",
														timeStyle: "short",
													}).format(device.lastActiveAt)}
												</span>
											)}
											{device.executionId !== null && (
												<span className="device-workspace-meta">{t`A previous operation needs to be checked.`}</span>
											)}
										</button>
									)
								})}
								{group !== undefined &&
									Match.value(group.connection).pipe(
										Match.when({ status: "available" }, () => (
											<button
												type="button"
												className="device-workspace-connect"
												disabled={!canPair || blocked}
												onClick={(event) => beginPairing(event.currentTarget)}
											>
												<Plus size={24} aria-hidden="true" />
												<span>{t`Connect computer`}</span>
												{workflow.ready && !canPair && (
													<span>{t`Connection is unavailable for this account.`}</span>
												)}
											</button>
										)),
										Match.when({ status: "unavailable" }, (connection) => (
											<div className="device-workspace-unavailable">
												<Icon size={38} strokeWidth={1.2} aria-hidden="true" />
												<strong>{t`Not supported yet`}</strong>
												<p>{connectionReason(connection.reason)}</p>
											</div>
										)),
										Match.exhaustive,
									)}
							</div>
						</section>
					)
				})}
			</div>
			<Dialog
				open={connecting}
				onOpenChange={(open) => {
					if (!open && !workflow.busy) closePairing()
				}}
			>
				<DialogContent
					className="device-workspace-dialog"
					showCloseButton={!workflow.busy}
					finalFocus={() => connectTrigger.current}
				>
					<DialogHeader>
						<DialogTitle>{t`Connect your computer`}</DialogTitle>
						<DialogDescription>{t`Start the OpenBot computer connector on your device, then enter the pairing code it shows. You will review the device before connecting it.`}</DialogDescription>
					</DialogHeader>
					<WorkflowNotice workflow={workflow} />
					{workflow.unconfirmed !== null && !workflow.busy && (
						<Button
							variant="outline"
							disabled={loading}
							onClick={() => void reviewAndRefresh()}
						>
							<RefreshCw size={16} />
							{t`Refresh devices`}
						</Button>
					)}
					<form
						onSubmit={(event) => {
							event.preventDefault()
							void checkPairing()
						}}
					>
						<label htmlFor={`${fieldId}-code`}>{t`Pairing code`}</label>
						<Input
							id={`${fieldId}-code`}
							value={code}
							maxLength={32}
							autoComplete="off"
							required
							disabled={blocked}
							onChange={(event) => {
								setCode(event.target.value)
								pairingRequest.current?.abort()
								setChecking(false)
								setPairing(null)
							}}
						/>
						<Button
							type="submit"
							variant="outline"
							disabled={!canPair || blocked || checking || code.trim() === ""}
						>
							{checking ? t`Finding your computer…` : t`Find my device`}
						</Button>
					</form>
					{pairing !== null && (
						<div className="device-workspace-pairing">
							<Laptop size={36} aria-hidden="true" />
							<h3>{pairing.hostname}</h3>
							<p>
								{pairing.os} · {pairing.arch}
							</p>
							<label htmlFor={`${fieldId}-name`}>{t`Computer name`}</label>
							<Input
								id={`${fieldId}-name`}
								value={name}
								maxLength={120}
								disabled={blocked}
								onChange={(event) => setName(event.target.value)}
							/>
							<p>{t`Only connect a device you recognize. Kay will be able to use it after you give access in its workspace.`}</p>
							<Button
								disabled={
									!canPair || blocked || pairing.expiresAt <= Date.now()
								}
								onClick={() => void approvePairing()}
							>
								{workflow.busy ? t`Connecting…` : t`Connect this device`}
							</Button>
						</div>
					)}
				</DialogContent>
			</Dialog>
		</section>
	)
}
