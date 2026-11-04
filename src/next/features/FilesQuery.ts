/** The SDK takes decoded query values and encodes them for HTTP. */
export const filesPageInput = (after?: string) => ({
	query: { limit: 48, ...(after === undefined ? {} : { after }) },
})
