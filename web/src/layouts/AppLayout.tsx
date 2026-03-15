import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Typography, Space, Tag } from 'antd';
import {
  DashboardOutlined,
  SearchOutlined,
  LineChartOutlined,
  BankOutlined,
  ExperimentOutlined,
} from '@ant-design/icons';
import { useMeta } from '../hooks/useData.ts';

const { Header, Sider, Content, Footer } = Layout;
const { Text } = Typography;

const NAV_ITEMS = [
  { key: '/', label: 'ダッシュボード', icon: <DashboardOutlined /> },
  { key: '/jobs', label: '求人一覧', icon: <SearchOutlined /> },
  { key: '/trends', label: 'トレンド', icon: <LineChartOutlined /> },
  { key: '/pipeline', label: 'パイプライン（準備中）', icon: <ExperimentOutlined />, disabled: false },
];

// 会社一覧はサイドナビには出さず、ダッシュボードからリンクで遷移
const COMPANY_NAV = {
  key: '/companies',
  label: '会社一覧',
  icon: <BankOutlined />,
};

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: meta } = useMeta();
  const [collapsed, setCollapsed] = useState(false);

  // 現在のパスに対応するメニューキーを特定
  const selectedKey = (() => {
    if (location.pathname.startsWith('/companies')) return '/companies';
    if (location.pathname.startsWith('/jobs')) return '/jobs';
    if (location.pathname.startsWith('/trends')) return '/trends';
    if (location.pathname.startsWith('/pipeline')) return '/pipeline';
    return '/';
  })();

  const allNavItems = [
    ...NAV_ITEMS.slice(0, 3),
    COMPANY_NAV,
    NAV_ITEMS[3],
  ];

  const formattedDate = meta?.last_updated
    ? new Date(meta.last_updated).toLocaleString('ja-JP', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '-';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        theme="dark"
        style={{ position: 'fixed', left: 0, top: 0, bottom: 0, zIndex: 100 }}
      >
        {/* ロゴ */}
        <div
          style={{
            padding: collapsed ? '16px 8px' : '16px',
            textAlign: 'center',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            marginBottom: 8,
            cursor: 'pointer',
          }}
          onClick={() => navigate('/')}
        >
          {collapsed ? (
            <span style={{ fontSize: 20 }}>💊</span>
          ) : (
            <Text strong style={{ color: '#fff', fontSize: 14 }}>
              💊 製薬求人DB
            </Text>
          )}
        </div>

        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={allNavItems.map((item) => ({
            key: item.key,
            icon: item.icon,
            label: item.label,
          }))}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>

      <Layout style={{ marginLeft: collapsed ? 80 : 200, transition: 'margin-left 0.2s' }}>
        <Header
          style={{
            background: '#fff',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
            position: 'sticky',
            top: 0,
            zIndex: 99,
          }}
        >
          <Text strong style={{ fontSize: 16 }}>
            製薬求人トラッカー
          </Text>
          <Space>
            {meta && (
              <>
                <Tag color="blue">総求人 {meta.total_active_jobs.toLocaleString()} 件</Tag>
                {meta.new_today > 0 && <Tag color="green">本日新着 {meta.new_today} 件</Tag>}
              </>
            )}
            <Text type="secondary" style={{ fontSize: 12 }}>
              最終更新: {formattedDate}
            </Text>
          </Space>
        </Header>

        <Content style={{ margin: '24px', minHeight: 'calc(100vh - 64px - 48px)' }}>
          <Outlet />
        </Content>

        <Footer style={{ textAlign: 'center', background: '#f5f5f5', padding: '12px 24px' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            製薬求人DB — 毎日自動更新 | データソース: 各社採用サイト
          </Text>
        </Footer>
      </Layout>
    </Layout>
  );
}
