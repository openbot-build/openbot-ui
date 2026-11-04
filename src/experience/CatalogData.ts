import cloud from "./catalog/CloudEntries.json"
import { decodeCatalog } from "./Catalog"

export const entries = decodeCatalog(cloud)
