//! B0: enigo click at absolute (points) coordinates: `cargo run --release --example click -- X Y`.
use enigo::{Button, Coordinate, Direction, Enigo, Mouse, Settings};

fn main() {
    let a: Vec<i32> = std::env::args().skip(1).map(|s| s.parse().unwrap()).collect();
    let mut enigo = Enigo::new(&Settings::default()).unwrap();
    enigo.move_mouse(a[0], a[1], Coordinate::Abs).unwrap();
    if let Some(ms) = a.get(2) {
        std::thread::sleep(std::time::Duration::from_millis(*ms as u64));
    }
    enigo.button(Button::Left, Direction::Click).unwrap();
}
