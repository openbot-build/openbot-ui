import { createCn } from "cn/config"

/** Keep Material type roles separate from text colors when merging classes. */
export const cn = createCn({
    extend: {
        classGroups: {
            "font-size": [{ text: [
                "display-large", "display-medium", "display-small",
                "headline-large", "headline-medium", "headline-small",
                "title-large", "title-medium", "title-small",
                "body-large", "body-medium", "body-small",
                "label-large", "label-medium", "label-small",
            ] }],
        },
    },
})
