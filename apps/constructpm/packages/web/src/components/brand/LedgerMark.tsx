import { clsx } from 'clsx';
import { PRODUCT_NAME } from '@constructpm/shared';
import logo from '../../assets/onesource-logo.png';

/**
 * One Source Ledger's mark: One Source's logo, a rule, and "Ledger".
 *
 * On a dark background (the sidebar, the sign-in page) the logo sits on a
 * white tile so its navy lettering still reads. Screen readers hear the
 * product's name once, not the logo's alt text and then "Ledger".
 */
export function LedgerMark({ tone, size = 'md' }: { tone: 'dark' | 'light'; size?: 'sm' | 'md' | 'lg' }) {
  const dark = tone === 'dark';
  return (
    <span role="img" aria-label={PRODUCT_NAME}
          className={clsx('inline-flex items-center', size === 'lg' ? 'gap-3.5' : size === 'md' ? 'gap-2.5' : 'gap-2')}>
      <span aria-hidden="true"
            className={clsx('inline-flex flex-shrink-0', dark && 'rounded-md bg-white',
              dark && (size === 'lg' ? 'px-2.5 py-2' : size === 'md' ? 'px-2 py-1.5' : 'px-1.5 py-1'))}>
        <img src={logo} alt=""
             className={clsx('w-auto', size === 'lg' ? (dark ? 'h-11' : 'h-14') : size === 'md' ? 'h-8' : 'h-6')} />
      </span>
      <span aria-hidden="true"
            className={clsx('self-stretch w-px my-1', dark ? 'bg-slate-600' : 'bg-slate-300')} />
      <span aria-hidden="true"
            className={clsx('font-semibold tracking-tight leading-none',
              dark ? 'text-white' : 'text-os-navy',
              size === 'lg' ? 'text-3xl' : size === 'md' ? 'text-lg' : 'text-base')}>
        Ledger
      </span>
    </span>
  );
}
