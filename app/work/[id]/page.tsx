import { MedalWorkbench } from "@/components/medal-workbench";

interface WorkPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function WorkPage({ params }: WorkPageProps) {
  const { id } = await params;

  return <MedalWorkbench initialWorkId={id} />;
}
