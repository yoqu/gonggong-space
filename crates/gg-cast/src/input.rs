//! The controller's input (`CastInput` in packages/protocol) replayed on this machine: points map from the video
//! frame onto the window, which is brought to the front first, since macOS delivers the first click to a background
//! app only as its activation (B0).
use anyhow::{Context, bail};
use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};
use serde::Deserialize;
use std::time::Duration;

/// How often, and at most how long, a raised window is checked for being in front before the press lands (B0: the
/// switch took 170–360 ms); past the limit the press goes ahead, as it would without a raise.
const SETTLE_POLL: Duration = Duration::from_millis(10);
const SETTLE_TIMEOUT: Duration = Duration::from_secs(1);

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mod {
    Meta,
    Ctrl,
    Alt,
    Shift,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "t", rename_all = "lowercase", deny_unknown_fields)]
pub enum Input {
    Down { x: f64, y: f64 },
    Move { x: f64, y: f64 },
    Up { x: f64, y: f64 },
    Wheel { x: f64, y: f64, dx: f64, dy: f64 },
    Text { text: String },
    Key { key: String, mods: Vec<Mod> },
}

impl Input {
    pub fn parse(payload: &[u8]) -> anyhow::Result<Input> {
        let input: Input = serde_json::from_slice(payload)?;
        match &input {
            Input::Down { x, y } | Input::Move { x, y } | Input::Up { x, y } | Input::Wheel { x, y, .. } => {
                if !(0.0..=1.0).contains(x) || !(0.0..=1.0).contains(y) {
                    bail!("point outside the frame");
                }
            }
            Input::Text { text } if text.is_empty() || text.chars().count() > 1000 => bail!("text length"),
            Input::Key { key, .. } => {
                named(key).context("unknown key")?;
            }
            Input::Text { .. } => {}
        }
        Ok(input)
    }
}

/// `CAST_KEYS`, or a letter or digit for shortcuts.
fn named(key: &str) -> Option<Key> {
    Some(match key {
        "Enter" => Key::Return,
        "Backspace" => Key::Backspace,
        "Delete" => Key::Delete,
        "Tab" => Key::Tab,
        "Escape" => Key::Escape,
        "ArrowUp" => Key::UpArrow,
        "ArrowDown" => Key::DownArrow,
        "ArrowLeft" => Key::LeftArrow,
        "ArrowRight" => Key::RightArrow,
        "Home" => Key::Home,
        "End" => Key::End,
        "PageUp" => Key::PageUp,
        "PageDown" => Key::PageDown,
        _ => {
            let mut chars = key.chars();
            let c = chars.next().filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit())?;
            if chars.next().is_some() {
                return None;
            }
            Key::Unicode(c)
        }
    })
}

fn modifier(m: Mod) -> Key {
    match m {
        Mod::Meta => Key::Meta,
        Mod::Ctrl => Key::Control,
        Mod::Alt => Key::Alt,
        Mod::Shift => Key::Shift,
    }
}

/// The window on screen, in the points enigo moves the pointer in (xcap reports the same space, B0).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Frame {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Frame {
    pub fn point(&self, x: f64, y: f64) -> (i32, i32) {
        (self.x + (x * self.width as f64).round() as i32, self.y + (y * self.height as f64).round() as i32)
    }
}

/// Browsers report wheel deltas in pixels, enigo scrolls in lines: about 40 px a line, never less than one.
pub fn lines(delta: f64) -> i32 {
    if delta == 0.0 {
        return 0;
    }
    let n = (delta.abs() / 40.0).round().max(1.0) as i32;
    if delta > 0.0 { n } else { -n }
}

/// Where input goes: the window, found again on each press so a moved window is still hit.
pub trait Target {
    fn frame(&mut self) -> anyhow::Result<Frame>;
    /// Brings the window in front of the others before a press lands on it; true when it was not.
    fn raise(&mut self) -> bool;
    /// Whether it is now the window in front, receiving input.
    fn frontmost(&mut self) -> bool;
}

/// Waits until a raised window is in front: the switch happens asynchronously in the window server.
async fn settle(target: &mut impl Target) {
    let deadline = tokio::time::Instant::now() + SETTLE_TIMEOUT;
    while !target.frontmost() && tokio::time::Instant::now() < deadline {
        tokio::time::sleep(SETTLE_POLL).await;
    }
}

pub struct Injector<T: Target> {
    enigo: Enigo,
    target: T,
    frame: Option<Frame>,
}

impl<T: Target> Injector<T> {
    pub fn new(target: T) -> anyhow::Result<Self> {
        Ok(Injector {
            enigo: Enigo::new(&Settings::default()).context("无法注入输入（需要辅助功能权限）")?,
            target,
            frame: None,
        })
    }

    async fn fresh(&mut self) -> anyhow::Result<Frame> {
        if self.target.raise() {
            settle(&mut self.target).await;
        }
        let frame = self.target.frame()?;
        self.frame = Some(frame);
        Ok(frame)
    }

    async fn known(&mut self) -> anyhow::Result<Frame> {
        match self.frame {
            Some(f) => Ok(f),
            None => self.fresh().await,
        }
    }

    pub async fn apply(&mut self, input: Input) -> anyhow::Result<()> {
        match input {
            Input::Down { x, y } => {
                let (px, py) = self.fresh().await?.point(x, y);
                self.enigo.move_mouse(px, py, Coordinate::Abs)?;
                // B0: pressed right after the move, macOS still reports the old pointer position.
                tokio::time::sleep(Duration::from_millis(20)).await;
                self.enigo.button(Button::Left, Direction::Press)?;
            }
            Input::Move { x, y } => {
                let (px, py) = self.known().await?.point(x, y);
                self.enigo.move_mouse(px, py, Coordinate::Abs)?;
            }
            Input::Up { x, y } => {
                let (px, py) = self.known().await?.point(x, y);
                self.enigo.move_mouse(px, py, Coordinate::Abs)?;
                self.enigo.button(Button::Left, Direction::Release)?;
            }
            Input::Wheel { x, y, dx, dy } => {
                let (px, py) = self.fresh().await?.point(x, y);
                self.enigo.move_mouse(px, py, Coordinate::Abs)?;
                for (delta, axis) in [(dy, Axis::Vertical), (dx, Axis::Horizontal)] {
                    if lines(delta) != 0 {
                        self.enigo.scroll(lines(delta), axis)?;
                    }
                }
            }
            Input::Text { text } => {
                self.fresh().await?;
                self.enigo.text(&text)?;
            }
            Input::Key { key, mods } => {
                self.fresh().await?;
                let key = named(&key).context("unknown key")?;
                for m in &mods {
                    self.enigo.key(modifier(*m), Direction::Press)?;
                }
                self.enigo.key(key, Direction::Click)?;
                for m in mods.iter().rev() {
                    self.enigo.key(modifier(*m), Direction::Release)?;
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Deserialize)]
    struct Cases {
        valid: Vec<serde_json::Value>,
        invalid: Vec<serde_json::Value>,
    }

    #[test]
    fn reads_the_shared_input_cases_like_the_web_writes_them() {
        let raw = include_str!("../../../packages/protocol/cases/cast-input.json");
        let cases: Cases = serde_json::from_str(raw).unwrap();
        for c in &cases.valid {
            assert!(Input::parse(c.to_string().as_bytes()).is_ok(), "{c}");
        }
        for c in &cases.invalid {
            assert!(Input::parse(c.to_string().as_bytes()).is_err(), "{c}");
        }
        assert_eq!(
            Input::parse(br#"{"t":"key","key":"a","mods":["meta"]}"#).unwrap(),
            Input::Key { key: "a".into(), mods: vec![Mod::Meta] }
        );
    }

    #[test]
    fn maps_frame_fractions_onto_the_window() {
        let f = Frame { x: 100, y: 50, width: 390, height: 844 };
        assert_eq!(f.point(0.0, 0.0), (100, 50));
        assert_eq!(f.point(0.5, 0.5), (295, 472));
        assert_eq!(f.point(1.0, 1.0), (490, 894));
    }

    #[test]
    fn scrolls_at_least_a_line_in_the_wheels_direction() {
        assert_eq!((lines(0.0), lines(3.0), lines(-3.0), lines(120.0), lines(-100.0)), (0, 1, -1, 3, -3));
    }

    /// In front after `after` checks, or never.
    struct Switching {
        after: Option<u32>,
        checks: u32,
    }

    impl Target for Switching {
        fn frame(&mut self) -> anyhow::Result<Frame> {
            unreachable!()
        }
        fn raise(&mut self) -> bool {
            true
        }
        fn frontmost(&mut self) -> bool {
            self.checks += 1;
            self.after.is_some_and(|n| self.checks >= n)
        }
    }

    #[tokio::test(start_paused = true)]
    async fn waits_until_the_raised_window_is_in_front() {
        let start = tokio::time::Instant::now();
        let mut slow = Switching { after: Some(30), checks: 0 };
        settle(&mut slow).await;
        assert_eq!(slow.checks, 30);
        // B0 measured 170–360 ms for the switch: waited as long as it takes, not a fixed guess.
        assert_eq!(start.elapsed(), SETTLE_POLL * 29);

        let start = tokio::time::Instant::now();
        let mut instant = Switching { after: Some(1), checks: 0 };
        settle(&mut instant).await;
        assert_eq!(start.elapsed(), Duration::ZERO);

        let start = tokio::time::Instant::now();
        settle(&mut Switching { after: None, checks: 0 }).await;
        assert!(start.elapsed() >= SETTLE_TIMEOUT && start.elapsed() < SETTLE_TIMEOUT + SETTLE_POLL * 2);
    }

    #[test]
    fn knows_the_named_keys_and_single_characters() {
        assert_eq!(named("Enter"), Some(Key::Return));
        assert_eq!(named("7"), Some(Key::Unicode('7')));
        assert_eq!(named("A"), None);
        assert_eq!(named("ab"), None);
        assert_eq!(named("F13"), None);
    }
}
