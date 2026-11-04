import "@fontsource-variable/dm-sans"
import { Anchor } from "./mascot/Mascot"
import "./KayBrand.css"

/** Uses the official KAI Kay lockup from https://www.kai.com/Kay/. */
export function KayBrand() {
	return (
		<div className="workbench-brand" role="img" aria-label="KAI Kay">
			<span className="workbench-brand-label" aria-hidden="true" />
			<span className="workbench-title-slot" data-kay-title-slot="">
				<svg
					className="workbench-title-name"
					viewBox="0 -84.783333 169.148682 98.266667"
					width="41.312"
					height="24"
					aria-hidden="true"
					focusable="false"
				>
					<text x="0" y="0" fontSize="100" fill="currentColor">
						Kay
					</text>
				</svg>
				<Anchor placement="header" className="workbench-kay-anchor" />
			</span>
		</div>
	)
}
