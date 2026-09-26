import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, CONTENT_MAX_WIDTH } from '../../constants/theme';

export default function TabLayout() {
  const { width } = useWindowDimensions();
  const { bottom } = useSafeAreaInsets();
  const wide = width >= 900;
  const navWidth = wide ? Math.min(CONTENT_MAX_WIDTH, width - 32) : width;
  const bottomPadding = Math.max(bottom, 12);
  return <Tabs screenOptions={{
    headerShown: false,
    tabBarActiveTintColor: COLORS.primaryDark,
    tabBarInactiveTintColor: '#756E62',
    tabBarLabelStyle: { fontSize: 11.5, fontWeight: '800', marginTop: 3 },
    tabBarItemStyle: { borderRadius: 18, marginHorizontal: 0, marginVertical: 1, minHeight: 58 },
    tabBarStyle: {
      height: 78 + bottomPadding, paddingBottom: bottomPadding, paddingTop: 8,
      backgroundColor: '#FFFDF7', borderTopWidth: 1, borderTopColor: COLORS.border,
      width: navWidth, marginLeft: wide ? (width - navWidth) / 2 : 0,
      borderTopLeftRadius: 23, borderTopRightRadius: 23,
    },
  }}>
    <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color, focused }) => <Icon name={focused ? 'home' : 'home-outline'} color={String(color)} focused={focused} /> }} />
    <Tabs.Screen name="cage" options={{ title: 'Cage', tabBarIcon: ({ color, focused }) => <Icon name={focused ? 'grid' : 'grid-outline'} color={String(color)} focused={focused} /> }} />
    <Tabs.Screen name="free-range" options={{ title: 'Free-range', tabBarIcon: ({ color, focused }) => <Icon name={focused ? 'leaf' : 'leaf-outline'} color={String(color)} focused={focused} /> }} />
    <Tabs.Screen name="alerts" options={{ title: 'Alerts', tabBarIcon: ({ color, focused }) => <Icon name={focused ? 'notifications' : 'notifications-outline'} color={String(color)} focused={focused} /> }} />
    <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color, focused }) => <Icon name={focused ? 'person-circle' : 'person-circle-outline'} color={String(color)} focused={focused} /> }} />
    <Tabs.Screen name="devices" options={{ href: null }} />
  </Tabs>;
}

function Icon({ name, color, focused }: { name: any; color: string; focused: boolean }) {
  return <View style={{ width: 54, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? COLORS.primarySoft : 'transparent' }}>
    <Ionicons name={name} color={color} size={27} />
  </View>;
}
