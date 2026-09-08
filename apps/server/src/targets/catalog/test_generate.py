import unittest
from generate import coordinate, extent, normalize


class CatalogImportTest(unittest.TestCase):
  def test_rejects_malformed_or_out_of_range_coordinates(self):
    for value, ra in [('24:00:00', True), ('23:60:00', True), ('12:00:60', True),
                      ('NaN', True), ('12:00:00', False), ('+90:00:01', False),
                      ('-91:00:00', False), ('-02:00:00', True)]:
      with self.subTest(value=value), self.assertRaises(ValueError):
        coordinate(value, ra)
    self.assertEqual(coordinate('-00:30:00', False), -0.5)
    self.assertEqual(coordinate('+90:00:00', False), 90)

  def test_unknown_extent_is_not_zero_and_invalid_extent_fails(self):
    self.assertIsNone(extent(''))
    for value in ['NaN', 'inf', '-1', '0', 'unknown']:
      with self.subTest(value=value), self.assertRaises(ValueError):
        extent(value)

  def test_excludes_nonexistent_duplicates_and_missing_positions(self):
    for kind in ['Dup', 'NonEx']:
      self.assertIsNone(normalize({'Type': kind}))
    self.assertIsNone(normalize({'Type': 'G', 'RA': '', 'Dec': ''}))


if __name__ == '__main__':
  unittest.main()
