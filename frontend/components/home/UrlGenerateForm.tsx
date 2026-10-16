import { zodResolver } from '@hookform/resolvers/zod';
import { CircleNotch, Globe, MagnifyingGlassPlus } from '@phosphor-icons/react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
      className="panel p-5 sm:p-6"
      noValidate
      onSubmit={handleSubmit(async (values) => onCrawl(values.url))}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label className="text-card-title font-semibold" htmlFor="target-url">
            Application URL
          </Label>
          <p className="mt-1 text-small text-muted-foreground">
            Use a localhost or staging deployment you own. The crawler needs
            a running application.
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Globe
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-describedby={errors.url ? 'target-url-error' : undefined}
            aria-invalid={errors.url ? true : undefined}
            autoComplete="url"
            className="min-h-12 pl-11 font-mono text-small"
            disabled={disabled}
            id="target-url"
            inputMode="url"
            placeholder="https://todo-app-staging.vercel.app"
            type="url"
            {...register('url')}
          />
          <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center gap-0.5 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground select-none">
            <span>⌘</span>K
          </kbd>
        </div>

        <Button
          className="min-h-12 px-5"
          disabled={disabled}
          size="lg"
          type="submit"
        >
          {disabled ? (
            <CircleNotch aria-hidden="true" className="animate-spin" />
          ) : (
            <MagnifyingGlassPlus aria-hidden="true" />
          )}
          {disabled ? busyLabel : 'Crawl Application'}
        </Button>
      </div>

      {errors.url ? (
        <p className="mt-3 text-small font-medium text-danger" id="target-url-error" role="alert">
          {errors.url.message}
        </p>
      ) : null}

      <p className="mt-4 font-mono text-caption text-muted-foreground">
        Example target: https://demo.playwright.dev/todomvc/
      </p>
    </form>
  );
}
