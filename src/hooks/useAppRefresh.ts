'use client';

import { useContext } from 'react';
import { AppRefreshContext } from '@/contexts/appRefreshContextValue';

export const useAppRefresh = () => {
  const context = useContext(AppRefreshContext);

  if (!context) {
    throw new Error('useAppRefresh must be used within AppRefreshProvider.');
  }

  return context;
};
