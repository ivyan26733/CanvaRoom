import { cookies } from 'next/headers';
import {
  appSchema,
  faqSchema,
  HomeContent,
  JsonLd,
} from './components/marketing';
import { HomeClient } from './home-client';
import { HOME_FAQ, SITE } from './lib/site';

export default async function HomePage() {
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
