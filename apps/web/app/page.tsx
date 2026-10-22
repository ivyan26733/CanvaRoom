import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  appSchema,
  faqSchema,
  HomeContent,
  JsonLd,
} from './components/marketing';
import { HomeClient } from './home-client';
import { HOME_FAQ, SITE } from './lib/site';

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Older links and ads opened the form on this page; it has its own now.
  const { mode, next } = await searchParams;
  if (mode === 'signup' || mode === 'login') {
    const query =
      typeof next === 'string' ? `?next=${encodeURIComponent(next)}` : '';
    redirect(`/${mode}${query}`);
  }
  // Set by the API on sign-in; its value is checked there, not here.
  const hasSession = (await cookies()).has('cb_session');
  return (
    <>
      <JsonLd
        data={[
          appSchema,
          faqSchema(HOME_FAQ),
          {
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: SITE.name,
            url: SITE.url,
          },
        ]}
      />
      <HomeClient hasSession={hasSession}>
        <HomeContent />
      </HomeClient>
    </>
  );
}
