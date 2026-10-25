pub mod ai;
#[cfg(feature = "desktop")]
pub mod desktop;
pub mod files;
pub mod store;
pub type Result<T> = std::result::Result<T, String>;
