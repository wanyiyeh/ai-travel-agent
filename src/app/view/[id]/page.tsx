import ViewContent from "@/components/ViewContent";

export default async function ViewItinerary({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ViewContent id={id} />;
}
