'use client';

import { useContext } from 'react';
import { FiscalYearContext } from '@/contexts/fiscalYearContextValue';

export const useFiscalYear = () => {
  const context = useContext(FiscalYearContext);

  if (!context) {
    throw new Error('useFiscalYear must be used within FiscalYearProvider.');
  }

  return context;
};
