import { useEffect, useState } from 'react';
import { apiBase } from '@/lib/api';

export function useApiBase(): string {
  const [base, setBase] = useState('');

  useEffect(() => {
    setBase(apiBase());
  }, []);

  return base;
}
