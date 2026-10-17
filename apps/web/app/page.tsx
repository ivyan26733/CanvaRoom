import { cookies, headers } from 'next/headers';
import {
  appSchema,
  faqSchema,
  HomeContent,
  JsonLd,
} from './components/marketing';
import { HomeClient } from './home-client';
import { currencyFor } from './lib/pricing';
import { HOME_FAQ, SITE } from './lib/site';

export default async function HomePage() {
  // Set by the API on sign-in; its value is checked there, not here.
  const hasSession = (await cookies()).has('cb_session');
  // Vercel's edge sets the visitor's country; prices show in rupees in India.
  const currency = currencyFor((await headers()).get('x-vercel-ip-country'));
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
        <HomeContent currency={currency} />
      </HomeClient>
    </>
  );
}
