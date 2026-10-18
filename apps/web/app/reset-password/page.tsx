import { redirect } from 'next/navigation';

/** Reset links were replaced by emailed codes; old links land on the new page. */
export default function ResetPasswordPage() {
  redirect('/forgot-password');
}
