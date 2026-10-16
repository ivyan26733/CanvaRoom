import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  appSchema,
  faqSchema,
  JsonLd,
  UseCaseView,
} from '../components/marketing';
import { SITE, USE_CASES } from '../lib/site';

type Props = { params: Promise<{ slug: string }> };

// Only the known use-case pages exist; anything else is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return USE_CASES.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const useCase = USE_CASES.find((item) => item.slug === slug);
  if (!useCase) return {};
  return {
    title: { absolute: `${useCase.title} | ${SITE.name}` },
    description: useCase.description,
    alternates: { canonical: `/${useCase.slug}` },
    openGraph: {
      title: useCase.title,
      description: useCase.description,
      url: `/${useCase.slug}`,
      type: 'website',
    },
    twitter: { title: useCase.title, description: useCase.description },
  };
}

export default async function UseCasePage({ params }: Props) {
  const { slug } = await params;
  const useCase = USE_CASES.find((item) => item.slug === slug);
  if (!useCase) notFound();
  return (
    <>
      <JsonLd
        data={[
          appSchema,
          faqSchema(useCase.faq),
          {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              {
                '@type': 'ListItem',
                position: 1,
                name: SITE.name,
                item: SITE.url,
              },
              {
                '@type': 'ListItem',
                position: 2,
                name: useCase.label,
                item: `${SITE.url}/${slug}`,
              },
            ],
          },
        ]}
      />
      <UseCaseView slug={slug} />
    </>
  );
}
