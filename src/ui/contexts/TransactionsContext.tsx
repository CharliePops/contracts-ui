// Copyright 2021 @paritytech/substrate-contracts-explorer authors & contributors
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useContext, useEffect } from 'react';
import { useApi } from './ApiContext';
import { TransactionOptions, Transaction as Tx, TransactionsState, Transaction } from 'types';
import { Transactions } from 'ui/components/Transactions';

let nextId = 0;

export function createTx(options: TransactionOptions): Transaction {
  return {
    ...options,
    id: ++nextId,
    isComplete: false,
    isProcessing: false,
    isError: false,
    isSuccess: false,
    events: {},
  };
}

export const TransactionsContext = React.createContext({} as unknown as TransactionsState);

export function TransactionsContextProvider({
  children,
}: React.PropsWithChildren<Partial<TransactionsState>>) {
  const { keyring, api } = useApi();
  const [txs, setTxs] = useState<Tx[]>([]);

  function queue(options: TransactionOptions): number {
    setTxs(txs => [
      ...txs.filter(
        ({ id, isComplete, isProcessing }) => id < nextId && !isComplete && !isProcessing
      ),
      createTx(options),
    ]);

    return nextId;
  }
  async function process(id: number) {
    const tx = txs.find(tx => id === tx.id);

    if (tx) {
      const { extrinsic, accountId, isValid, onSuccess } = tx;

      setTxs(txs => [
        ...txs.map(tx => {
          return tx.id === id
            ? {
                ...tx,
                isProcessing: true,
              }
            : tx;
        }),
      ]);

      const unsub = await extrinsic.signAndSend(keyring.getPair(accountId), {}, async result => {
        if (result.isFinalized) {
          const events: Record<string, number> = {};

          result.events.forEach(record => {
            const { event } = record;
            const key = `${event.section}:${event.method}`;
            if (!events[key]) {
              events[key] = 1;
            } else {
              events[key]++;
            }
          });

          console.log(result);

          if (!isValid(result)) {
            setTxs(txs => [
              ...txs.map(tx => {
                return tx.id === id
                  ? {
                      ...tx,
                      isComplete: true,
                      isProcessing: false,
                      isError: true,
                      events,
                    }
                  : tx;
              }),
            ]);

            let message = 'Transaction failed';

            if (result.dispatchError?.isModule) {
              const decoded = api.registry.findMetaError(result.dispatchError.asModule);
              message = `${decoded.section.toUpperCase()}.${decoded.method}: ${decoded.docs}`;
            }
            throw new Error(message);
          }

          onSuccess && (await onSuccess(result));

          setTxs(txs => [
            ...txs.map(tx => {
              return tx.id === id
                ? {
                    ...tx,
                    isComplete: true,
                    isProcessing: false,
                    isSuccess: true,
                    events,
                  }
                : tx;
            }),
          ]);

          unsub();
        }
      });
    }
  }

  function unqueue(id: number) {
    setTxs([...txs.filter(tx => tx.id !== id || tx.isProcessing || tx.isComplete)]);
  }

  function dismiss(id: number) {
    setTxs([...txs.filter(tx => tx.id !== id)]);
  }

  useEffect((): (() => void) => {
    let autoDismiss: NodeJS.Timeout;

    if (txs.length > 0) {
      autoDismiss = setTimeout((): void => {
        setTxs([...txs.filter(({ isComplete }) => !isComplete)]);
      }, 5000);
    }

    return () => clearTimeout(autoDismiss);
  }, [txs]);

  const state = {
    txs,
    dismiss,
    process,
    queue,
    unqueue,
  };

  return (
    <TransactionsContext.Provider value={state}>
      <Transactions {...state} />
      {children}
    </TransactionsContext.Provider>
  );
}

export const useTransactions = () => useContext(TransactionsContext);
