import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, CircleNotch, Globe } from '@phosphor-icons/react';
import { useForm } from 'react-hook-form';
import { useEffect } from 'react';
import { targetUrlSchema, type TargetUrlForm } from '@/lib/validation';

interface UrlGenerateFormProps {
  busy: boolean;
  busyLabel: string;
  onCrawl: (url: string) => Promise<void>;
  initialUrl?: string;
}

export function UrlGenerateForm({
  busy,
  busyLabel,
  onCrawl,
  initialUrl,
}: UrlGenerateFormProps) {
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<TargetUrlForm>({
    resolver: zodResolver(targetUrlSchema),
    defaultValues: {
      url: initialUrl ?? '',
    },
  });

  useEffect(() => {
    if (initialUrl) {
      setValue('url', initialUrl);
    }
  }, [initialUrl, setValue]);

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
            placeholder="https://your-app.com"
            type="text"
            {...register('url')}
          />
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
