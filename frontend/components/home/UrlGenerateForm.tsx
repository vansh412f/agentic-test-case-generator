import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, CircleNotch, Globe } from '@phosphor-icons/react';
import { useForm } from 'react-hook-form';
import { targetUrlSchema, type TargetUrlForm } from '@/lib/validation';

interface UrlGenerateFormProps {
  busy: boolean;
  busyLabel: string;
  onCrawl: (url: string) => Promise<void>;
}

export function UrlGenerateForm({
  busy,
  busyLabel,
  onCrawl,
}: UrlGenerateFormProps) {
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<TargetUrlForm>({
    resolver: zodResolver(targetUrlSchema),
    defaultValues: {
      url: '',
    },
  });

  const disabled = busy || isSubmitting;

  return (
    <form
      noValidate
      onSubmit={handleSubmit(async (values) => onCrawl(values.url))}
    >
      <div className="url-box">
        <div className="input-wrap">
          <Globe aria-hidden="true" className="h-5 w-5 shrink-0 text-[#869189]" />
          <input
            aria-describedby={errors.url ? 'target-url-error' : undefined}
            aria-invalid={errors.url ? true : undefined}
            autoComplete="url"
            disabled={disabled}
            id="target-url"
            inputMode="url"
            placeholder="https://your-app.com or localhost:3000"
            type="text"
            {...register('url')}
          />
          <kbd>⌘ K</kbd>
        </div>
        <button className="primary-button" disabled={disabled} type="submit">
          {disabled ? (
            <>
              <CircleNotch aria-hidden="true" className="h-4 w-4 animate-spin" />
              {busyLabel}
            </>
          ) : (
            <>
              Crawl <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </>
          )}
        </button>
      </div>

      {errors.url ? (
        <p className="mt-2 text-small font-medium text-danger" id="target-url-error" role="alert">
          {errors.url.message}
        </p>
      ) : null}

      <p className="hint">
        Try an example:{' '}
        <button
          type="button"
          onClick={() =>
            setValue('url', 'https://demo.playwright.dev/todomvc/', {
              shouldValidate: true,
            })
          }
        >
          todomvc
        </button>{' '}
        <span>·</span>{' '}
        <button
          type="button"
          onClick={() =>
            setValue('url', 'http://localhost:3000', {
              shouldValidate: true,
            })
          }
        >
          localhost demo
        </button>
      </p>
    </form>
  );
}
