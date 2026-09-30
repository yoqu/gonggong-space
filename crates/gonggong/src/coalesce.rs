use futures_util::FutureExt;
use futures_util::future::{BoxFuture, Shared};
use std::collections::HashMap;
use std::future::Future;
use std::hash::Hash;
use std::sync::Mutex;

/// Callers asking for the same key while it is being computed share that one computation.
pub struct Coalesce<K, V: Clone> {
    inflight: Mutex<HashMap<K, Shared<BoxFuture<'static, V>>>>,
}

impl<K, V: Clone> Default for Coalesce<K, V> {
    fn default() -> Self {
        Self { inflight: Mutex::default() }
    }
}

impl<K: Hash + Eq + Clone, V: Clone + Send + Sync + 'static> Coalesce<K, V> {
    /// `compute` only runs when no caller is already computing `key`.
    pub async fn run(&self, key: K, compute: impl Future<Output = V> + Send + 'static) -> V {
        let fut = self.inflight.lock().unwrap().entry(key.clone()).or_insert_with(|| compute.boxed().shared()).clone();
        let value = fut.clone().await;
        let mut inflight = self.inflight.lock().unwrap();
        if inflight.get(&key).is_some_and(|f| f.ptr_eq(&fut)) {
            inflight.remove(&key);
        }
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[tokio::test]
    async fn concurrent_callers_share_one_computation_and_later_ones_recompute() {
        let c = Coalesce::<&str, usize>::default();
        let runs = Arc::new(AtomicUsize::new(0));
        let compute = |runs: Arc<AtomicUsize>| async move {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            runs.fetch_add(1, Ordering::SeqCst) + 1
        };
        let (a, b) = tokio::join!(c.run("w", compute(runs.clone())), c.run("w", compute(runs.clone())));
        assert_eq!((a, b), (1, 1));
        assert_eq!(c.run("other", compute(runs.clone())).await, 2);
        assert_eq!(c.run("w", compute(runs.clone())).await, 3);
    }
}
