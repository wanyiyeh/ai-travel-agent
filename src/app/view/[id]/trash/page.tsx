import TrashView from "@/components/TrashView";

export default async function ItineraryTrash({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TrashView itineraryId={id} />;
}
