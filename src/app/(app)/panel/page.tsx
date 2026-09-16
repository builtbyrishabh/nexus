import { PanelBoard } from "~/app/(app)/panel/panel-board";
import { listCreators } from "~/server/domain/roster";

/**
 * Panel route: resolve the lineup from the ingested roster (first-ingested order) on the server, then
 * hand it to the client board. The roster is the single source of truth — no hard-coded lineup.
 */
export default async function PanelPage() {
  const creators = await listCreators();
  return <PanelBoard creators={creators} />;
}
