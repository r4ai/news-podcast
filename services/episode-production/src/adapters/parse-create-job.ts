import { parse } from "@news-podcast/kernel"

import { CreateJobCommandSchema } from "../domain/episode-job.js"

export const parseCreateJobCommand = parse(CreateJobCommandSchema)
