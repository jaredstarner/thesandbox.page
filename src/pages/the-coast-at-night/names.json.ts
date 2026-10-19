import { catalog } from './_catalog';

// Every light's name, in catalogue order, for the search box.
export const GET = () => Response.json(catalog().lights.map((l) => l.detail.name));
